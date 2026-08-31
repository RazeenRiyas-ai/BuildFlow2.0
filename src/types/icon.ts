import { AndroidSymbol, SFSymbol } from 'expo-symbols';

/** A cross-platform icon name for SymbolView: SF Symbol on iOS, Material Symbol on Android/web. */
export interface AppIcon {
  ios: SFSymbol;
  android: AndroidSymbol;
  web: AndroidSymbol;
}
