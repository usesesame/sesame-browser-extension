import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50
const EOCD_LENGTH = 22
const VERSION_MADE_BY = 0x031e
const VERSION_NEEDED = 20
const METHOD_DEFLATE = 8
const FILE_MODE = 0o100644
const DOS_DATE = 0x0021
const DOS_TIME = 0x0000

export function createZip(entries) {
  const seen = new Set()
  const prepared = [...entries]
    .map(({ path, data }) => {
      if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
        throw new Error(`Refusing to archive an unsafe entry path: ${path}`)
      }
      if (seen.has(path)) throw new Error(`Duplicate entry path: ${path}`)
      seen.add(path)
      const uncompressed = Buffer.from(data)
      return { path, uncompressed, compressed: deflateRawSync(uncompressed, { level: 9 }) }
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))

  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of prepared) {
    const name = Buffer.from(entry.path, 'utf8')
    const checksum = crc32(entry.uncompressed)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(LOCAL_SIGNATURE, 0)
    local.writeUInt16LE(VERSION_NEEDED, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(METHOD_DEFLATE, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(entry.compressed.length, 18)
    local.writeUInt32LE(entry.uncompressed.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    central.writeUInt16LE(VERSION_MADE_BY, 4)
    central.writeUInt16LE(VERSION_NEEDED, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(METHOD_DEFLATE, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(entry.compressed.length, 20)
    central.writeUInt32LE(entry.uncompressed.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE((FILE_MODE << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)

    locals.push(local, entry.compressed)
    centrals.push(central)
    offset += local.length + entry.compressed.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(EOCD_LENGTH)
  end.writeUInt32LE(EOCD_SIGNATURE, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(prepared.length, 8)
  end.writeUInt16LE(prepared.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, directory, end])
}

export function readZip(archive) {
  const end = archive.length - EOCD_LENGTH
  if (end < 0 || archive.readUInt32LE(end) !== EOCD_SIGNATURE) {
    throw new Error('Archive has no end-of-central-directory record.')
  }
  const count = archive.readUInt16LE(end + 10)
  let cursor = archive.readUInt32LE(end + 16)
  const entries = []

  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('Central directory entry is malformed.')
    }
    const checksum = archive.readUInt32LE(cursor + 16)
    const compressedLength = archive.readUInt32LE(cursor + 20)
    const uncompressedLength = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const localOffset = archive.readUInt32LE(cursor + 42)
    const path = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength)

    if (archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`Local header for ${path} is malformed.`)
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const data = inflateRawSync(archive.subarray(start, start + compressedLength))

    if (data.length !== uncompressedLength) throw new Error(`${path} has the wrong length.`)
    if (crc32(data) !== checksum) throw new Error(`${path} fails its CRC-32 check.`)

    entries.push({ path, data })
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}
