# Which folder to load

This source code directory intentionally does not contain a root `manifest.json`,
so the browser's **Load unpacked** dialog cannot select it.

- Chrome: select `dist/chrome`
- Edge: select `dist/edge`

The selected directory must contain `manifest.json`, `background.js`,
`popup.html`, and the `icons` directory. If those files are missing, the build
output is not present or is stale.

These unpacked folders are for development and private testing with disposable
credentials. Normal users should eventually install the signed extension from
the Chrome Web Store or Microsoft Edge Add-ons; they should not build the
extension or run native-host scripts.
