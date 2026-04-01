# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Generate native folders (Android and iOS)

   ```bash
   npm run prebuild
   ```

   > This also runs the `withExcludeX86SimulatorArch` config plugin which automatically patches the iOS `Podfile` to exclude `x86_64` simulator architectures. This is required because `bdk-rn`'s `BdkRnFramework.xcframework` only ships `arm64` slices — without this patch the build fails with `ld: library 'bdkffi' not found`.

3. Install iOS dependencies (CocoaPods)

   ```bash
   cd ios && LANG=en_US.UTF-8 pod install && cd ..
   ```

   > `LANG=en_US.UTF-8` is required to avoid a Ruby/CocoaPods encoding error on some macOS setups.

4. Run the app

   ```bash
   # iOS (Release)
   npm run ios:release

   # Android (Release)
   npm run android:release
   ```

### Prerequisites

- **iOS**: Xcode installed with at least one iOS Simulator runtime. Accept the Xcode license before first use:
  ```bash
  sudo xcodebuild -license accept
  ```
- **Android**: Android Studio installed with the Android SDK. Add the following to your shell profile (`~/.zshrc` or `~/.bashrc`):
  ```bash
  export ANDROID_HOME=$HOME/Library/Android/sdk
  export PATH=$PATH:$ANDROID_HOME/platform-tools
  export PATH=$PATH:$ANDROID_HOME/emulator
  ```
  Then reload: `source ~/.zshrc`

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
