# Privacy — PDFwright

PDFwright works locally. This is the English version of `PRIVACY.md`; the Russian text in the repository root is the original.

- The app does not create accounts.
- The app contains no telemetry and no ads.
- Opened documents, their contents, typed text, signatures and the clipboard are not sent to the developer or to third parties.
- Files are saved where the user chooses. If that is OneDrive, a network folder or another synced folder, its provider may transfer the files independently of PDFwright.
- The recent files list is a local list of paths (with the time of opening and the page count), not a copy of the documents. A file gets there when it is opened in a tab or saved by the app; files picked only as a source for "Merge", "Split" and other tools are not added.
- The app contacts GitHub only for updates. A check requests `latest.yml` of the latest published `iHoooK/PDFwright` release: automatically 10 seconds after startup and every 12 hours while the app is open, and when you click "Check for updates". The automatic check can be turned off in **Settings → Updates → Check for updates automatically**. The installer is downloaded only after you click "Update" or "Download and install". GitHub and its download servers receive the usual HTTP connection data, including the IP address and a User-Agent with the app version; documents, settings, recent files and the clipboard are not sent in these requests.
- The downloaded installer is verified against the sha512 from the release metadata and stored in `%LocalAppData%\pdfwright-updater`. Incomplete and rejected downloads are deleted; after installation the file can be deleted manually.
- The buttons for the releases page, the website and the author's channels open an external browser on an explicit command. Only a predefined list of addresses is allowed; the app does not open links from PDF documents themselves.

Service data (settings, recent files) is stored in `%APPDATA%\PDFwright`, downloaded installers in `%LocalAppData%\pdfwright-updater`:

```text
%APPDATA%\PDFwright
%LocalAppData%\pdfwright-updater
```

To remove it, close the app and delete these folders. The uninstaller does not touch user documents.

When building the app yourself, `npm ci` downloads open-source dependencies from npm. After that the app runs locally; `npm run dev` does not send documents or settings over the network.
