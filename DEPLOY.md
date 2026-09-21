# Putting clefcraft on your phone

The app is published to **GitHub Pages**, a free host that serves it over
HTTPS. HTTPS is required, not a nicety: browsers only allow an app to read
a MIDI device from a secure address, so a plain-http address would show
the scores but never hear the piano.

Once it's up, you install it from Chrome on your phone like an app. Your
scores and corrections are stored **on the phone**. Nothing is uploaded,
and they don't sync between devices.

## One-time setup

You need a GitHub account (free) and Git for Windows
(<https://git-scm.com/download/win>).

1. **Create an empty repository** on github.com. Name it `clefcraft` and
   don't tick "Add a README"; the project already has one.

2. **Push the project.** In PowerShell:

   ```powershell
   cd C:\Users\timon\Documents\piano-notes
   git init
   git add .
   git commit -m "clefcraft"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/clefcraft.git
   git push -u origin main
   ```

   `node_modules` and `dist` are excluded by `.gitignore`, so this uploads
   only the source.

3. **Switch Pages on.** In the repository, open **Settings → Pages**. Under
   *Build and deployment*, set **Source** to **GitHub Actions**.

4. **Wait for the first deploy.** The **Actions** tab shows a run called
   *Deploy to GitHub Pages*, which takes about a minute. It runs the tests
   and the type check first, and a failure stops the deploy, so a broken
   build never replaces a working one. When it's done, the app is at:

   `https://YOUR-USERNAME.github.io/clefcraft/`

## Installing on Android

1. Open that address in **Chrome** on the phone.
2. Tap **⋮ → Add to Home screen** (on some phones it says **Install app**).
3. Open it from the home-screen icon. It runs full-screen, and once it's
   been opened online it works offline too.

## Connecting the piano

The piano's USB cable goes into a **USB-OTG adapter**: USB-C or micro-USB
to full-size USB-A, whichever matches the phone. Plug it in, open the app,
and allow MIDI access when Chrome asks. From then on it behaves exactly as
it does on the PC.

If the app says "Not connected", unplug and replug the piano with the app
open, then tap **Settings → Connect**.

## Updating

Change the code on your PC, then:

```powershell
git add .
git commit -m "What changed"
git push
```

The phone picks up the new version the next time the app is opened while
online. Your saved scores and corrections survive updates, because they
live in the phone's storage, not in the app's files.
