/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { DynamicColor } from './dynamic_color.js';
import type { DynamicScheme } from './dynamic_scheme';
/**
 * DynamicColors for the colors in the Material Design system.
 */
export declare class MaterialDynamicColors {
    static contentAccentToneDelta: number;
    private static readonly colorSpec;
    highestSurface(s: DynamicScheme): DynamicColor;
    primaryPaletteKeyColor(): DynamicColor;
    secondaryPaletteKeyColor(): DynamicColor;
    tertiaryPaletteKeyColor(): DynamicColor;
    neutralPaletteKeyColor(): DynamicColor;
    neutralVariantPaletteKeyColor(): DynamicColor;
    errorPaletteKeyColor(): DynamicColor;
    background(): DynamicColor;
    onBackground(): DynamicColor;
    surface(): DynamicColor;
    surfaceDim(): DynamicColor;
    surfaceBright(): DynamicColor;
    surfaceContainerLowest(): DynamicColor;
    surfaceContainerLow(): DynamicColor;
    surfaceContainer(): DynamicColor;
    surfaceContainerHigh(): DynamicColor;
    surfaceContainerHighest(): DynamicColor;
    onSurface(): DynamicColor;
    surfaceVariant(): DynamicColor;
    onSurfaceVariant(): DynamicColor;
    outline(): DynamicColor;
    outlineVariant(): DynamicColor;
    inverseSurface(): DynamicColor;
    inverseOnSurface(): DynamicColor;
    shadow(): DynamicColor;
    scrim(): DynamicColor;
    surfaceTint(): DynamicColor;
    primary(): DynamicColor;
    primaryDim(): DynamicColor | undefined;
    onPrimary(): DynamicColor;
    primaryContainer(): DynamicColor;
    onPrimaryContainer(): DynamicColor;
    inversePrimary(): DynamicColor;
    primaryFixed(): DynamicColor;
    primaryFixedDim(): DynamicColor;
    onPrimaryFixed(): DynamicColor;
    onPrimaryFixedVariant(): DynamicColor;
    secondary(): DynamicColor;
    secondaryDim(): DynamicColor | undefined;
    onSecondary(): DynamicColor;
    secondaryContainer(): DynamicColor;
    onSecondaryContainer(): DynamicColor;
    secondaryFixed(): DynamicColor;
    secondaryFixedDim(): DynamicColor;
    onSecondaryFixed(): DynamicColor;
    onSecondaryFixedVariant(): DynamicColor;
    tertiary(): DynamicColor;
    tertiaryDim(): DynamicColor | undefined;
    onTertiary(): DynamicColor;
    tertiaryContainer(): DynamicColor;
    onTertiaryContainer(): DynamicColor;
    tertiaryFixed(): DynamicColor;
    tertiaryFixedDim(): DynamicColor;
    onTertiaryFixed(): DynamicColor;
    onTertiaryFixedVariant(): DynamicColor;
    error(): DynamicColor;
    errorDim(): DynamicColor | undefined;
    onError(): DynamicColor;
    errorContainer(): DynamicColor;
    onErrorContainer(): DynamicColor;
    allColors: DynamicColor[];
    /** @deprecated Use highestSurface() instead. */
    static highestSurface(s: DynamicScheme): DynamicColor;
    /** @deprecated Use primaryPaletteKeyColor() instead. */
    static primaryPaletteKeyColor: DynamicColor;
    /** @deprecated Use secondaryPaletteKeyColor() instead. */
    static secondaryPaletteKeyColor: DynamicColor;
    /** @deprecated Use tertiaryPaletteKeyColor() instead. */
    static tertiaryPaletteKeyColor: DynamicColor;
    /** @deprecated Use neutralPaletteKeyColor() instead. */
    static neutralPaletteKeyColor: DynamicColor;
    /** @deprecated Use neutralVariantPaletteKeyColor() instead. */
    static neutralVariantPaletteKeyColor: DynamicColor;
    /** @deprecated Use background() instead. */
    static background: DynamicColor;
    /** @deprecated Use background() instead. */
    static onBackground: DynamicColor;
    /** @deprecated Use surface() instead. */
    static surface: DynamicColor;
    /** @deprecated Use surfaceDim() instead. */
    static surfaceDim: DynamicColor;
    /** @deprecated Use surfaceBright() instead. */
    static surfaceBright: DynamicColor;
    /** @deprecated Use surfaceContainerLowest() instead. */
    static surfaceContainerLowest: DynamicColor;
    /** @deprecated Use surfaceContainerLow() instead. */
    static surfaceContainerLow: DynamicColor;
    /** @deprecated Use surfaceContainer() instead. */
    static surfaceContainer: DynamicColor;
    /** @deprecated Use surfaceContainerHigh() instead. */
    static surfaceContainerHigh: DynamicColor;
    /** @deprecated Use surfaceContainerHighest() instead. */
    static surfaceContainerHighest: DynamicColor;
    /** @deprecated Use onSurface() instead. */
    static onSurface: DynamicColor;
    /** @deprecated Use surfaceVariant() instead. */
    static surfaceVariant: DynamicColor;
    /** @deprecated Use onSurfaceVariant() instead. */
    static onSurfaceVariant: DynamicColor;
    /** @deprecated Use inverseSurface() instead. */
    static inverseSurface: DynamicColor;
    /** @deprecated Use inverseOnSurface() instead. */
    static inverseOnSurface: DynamicColor;
    /** @deprecated Use outline() instead. */
    static outline: DynamicColor;
    /** @deprecated Use outlineVariant() instead. */
    static outlineVariant: DynamicColor;
    /** @deprecated Use shadow() instead. */
    static shadow: DynamicColor;
    /** @deprecated Use scrim() instead. */
    static scrim: DynamicColor;
    /** @deprecated Use surfaceTint() instead. */
    static surfaceTint: DynamicColor;
    /** @deprecated Use primary() instead. */
    static primary: DynamicColor;
    /** @deprecated Use onPrimary() instead. */
    static onPrimary: DynamicColor;
    /** @deprecated Use primaryContainer() instead. */
    static primaryContainer: DynamicColor;
    /** @deprecated Use onPrimaryContainer() instead. */
    static onPrimaryContainer: DynamicColor;
    /** @deprecated Use inversePrimary() instead. */
    static inversePrimary: DynamicColor;
    /** @deprecated Use secondary() instead. */
    static secondary: DynamicColor;
    /** @deprecated Use onSecondary() instead. */
    static onSecondary: DynamicColor;
    /** @deprecated Use secondaryContainer() instead. */
    static secondaryContainer: DynamicColor;
    /** @deprecated Use onSecondaryContainer() instead. */
    static onSecondaryContainer: DynamicColor;
    /** @deprecated Use tertiary() instead. */
    static tertiary: DynamicColor;
    /** @deprecated Use onTertiary() instead. */
    static onTertiary: DynamicColor;
    /** @deprecated Use tertiaryContainer() instead. */
    static tertiaryContainer: DynamicColor;
    /** @deprecated Use onTertiaryContainer() instead. */
    static onTertiaryContainer: DynamicColor;
    /** @deprecated Use error() instead. */
    static error: DynamicColor;
    /** @deprecated Use onError() instead. */
    static onError: DynamicColor;
    /** @deprecated Use errorContainer() instead. */
    static errorContainer: DynamicColor;
    /** @deprecated Use onErrorContainer() instead. */
    static onErrorContainer: DynamicColor;
    /** @deprecated Use primaryFixed() instead. */
    static primaryFixed: DynamicColor;
    /** @deprecated Use primaryFixedDim() instead. */
    static primaryFixedDim: DynamicColor;
    /** @deprecated Use onPrimaryFixed() instead. */
    static onPrimaryFixed: DynamicColor;
    /** @deprecated Use onPrimaryFixedVariant() instead. */
    static onPrimaryFixedVariant: DynamicColor;
    /** @deprecated Use secondaryFixed() instead. */
    static secondaryFixed: DynamicColor;
    /** @deprecated Use secondaryFixedDim() instead. */
    static secondaryFixedDim: DynamicColor;
    /** @deprecated Use onSecondaryFixed() instead. */
    static onSecondaryFixed: DynamicColor;
    /** @deprecated Use onSecondaryFixedVariant() instead. */
    static onSecondaryFixedVariant: DynamicColor;
    /** @deprecated Use tertiaryFixed() instead. */
    static tertiaryFixed: DynamicColor;
    /** @deprecated Use tertiaryFixedDim() instead. */
    static tertiaryFixedDim: DynamicColor;
    /** @deprecated Use onTertiaryFixed() instead. */
    static onTertiaryFixed: DynamicColor;
    /** @deprecated Use onTertiaryFixedVariant() instead. */
    static onTertiaryFixedVariant: DynamicColor;
}
