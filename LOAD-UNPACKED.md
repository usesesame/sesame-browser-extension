# Which folder to load

This source code directory intentionally does not contain a root `manifest.json`,
so the browser's **Load unpacked** dialog cannot select it.

- Chrome: select `dist/chrome`
- Edge: select `dist/edge`

The selected directory must contain `manifest.json`, `background.js`,
`popup.html`, and the `icons` directory. If those files are missing, the build
output is not present or is stale.

A released build is also on the GitHub releases page as
`sesame-extension-<version>-chromium.zip`. Unzip it and select the unzipped
folder in the same dialog. It connects to the desktop app like the store
version, but the browser will not update it, so install each new release by
hand.

A folder you build yourself is for development and private testing with
disposable credentials. Normal users should install the extension from the
Chrome Web Store, Microsoft Edge Add-ons or a GitHub release; they should not
build the extension or run native-host scripts.
