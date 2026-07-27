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
import { Hct } from '../hct/hct.js';
import { TonalPalette } from '../palettes/tonal_palette.js';
import { SpecVersion } from './color_spec.js';
import { DynamicColor } from './dynamic_color.js';
import { MaterialDynamicColors } from './material_dynamic_colors.js';
import { Variant } from './variant.js';
/**
 * The platform on which this scheme is intended to be used. Only used in the
 * 2025 spec.
 */
export type Platform = 'phone' | 'watch';
/**
 * @param sourceColorArgb The source color of the theme as an ARGB 32-bit
 *     integer.
 * @param variant The variant, or style, of the theme.
 * @param contrastLevel Value from -1 to 1. -1 represents minimum contrast, 0
 *     represents standard (i.e. the design as spec'd), and 1 represents maximum
 *     contrast.
 * @param isDark Whether the scheme is in dark mode or light mode.
 * @param platform The platform on which this scheme is intended to be used.
 * @param specVersion The version of the design spec that this scheme is based
 *     on.
 * @param primaryPalette Given a tone, produces a color. Hue and chroma of the
 *     color are specified in the design specification of the variant. Usually
 *     colorful.
 * @param secondaryPalette Given a tone, produces a color. Hue and chroma of the
 *     color are specified in the design specification of the variant. Usually
 *     less colorful.
 * @param tertiaryPalette Given a tone, produces a color. Hue and chroma of the
 *     color are specified in the design specification of the variant. Usually a
 *     different hue from primary and colorful.
 * @param neutralPalette Given a tone, produces a color. Hue and chroma of the
 *     color are specified in the design specification of the variant. Usually
 *     not colorful at all, intended for background & surface colors.
 * @param neutralVariantPalette Given a tone, produces a color. Hue and chroma
 *     of the color are specified in the design specification of the variant.
 *     Usually not colorful, but slightly more colorful than Neutral. Intended
 *     for backgrounds & surfaces.
 */
interface DynamicSchemeOptions {
    sourceColorHct: Hct;
    variant: Variant;
    contrastLevel: number;
    isDark: boolean;
    platform?: Platform;
    specVersion?: SpecVersion;
    primaryPalette?: TonalPalette;
    secondaryPalette?: TonalPalette;
    tertiaryPalette?: TonalPalette;
    neutralPalette?: TonalPalette;
    neutralVariantPalette?: TonalPalette;
    errorPalette?: TonalPalette;
}
/**
 * Constructed by a set of values representing the current UI state (such as
 * whether or not its dark theme, what the theme style is, etc.), and
 * provides a set of TonalPalettes that can create colors that fit in
 * with the theme style. Used by DynamicColor to resolve into a color.
 */
export declare class DynamicScheme {
    static readonly DEFAULT_SPEC_VERSION = "2021";
    static readonly DEFAULT_PLATFORM = "phone";
    /**
     * The source color of the theme as an HCT color.
     */
    sourceColorHct: Hct;
    /** The source color of the theme as an ARGB 32-bit integer. */
    readonly sourceColorArgb: number;
    /** The variant, or style, of the theme. */
    readonly variant: Variant;
    /**
     * Value from -1 to 1. -1 represents minimum contrast. 0 represents standard
     * (i.e. the design as spec'd), and 1 represents maximum contrast.
     */
    readonly contrastLevel: number;
    /** Whether the scheme is in dark mode or light mode. */
    readonly isDark: boolean;
    /** The platform on which this scheme is intended to be used. */
    readonly platform: Platform;
    /** The version of the design spec that this scheme is based on. */
    readonly specVersion: SpecVersion;
    /**
     * Given a tone, produces a color. Hue and chroma of the
     * color are specified in the design specification of the variant. Usually
     * colorful.
     */
    readonly primaryPalette: TonalPalette;
    /**
     * Given a tone, produces a color. Hue and chroma of
     * the color are specified in the design specification of the variant. Usually
     * less colorful.
     */
    readonly secondaryPalette: TonalPalette;
    /**
     * Given a tone, produces a color. Hue and chroma of
     * the color are specified in the design specification of the variant. Usually
     * a different hue from primary and colorful.
     */
    readonly tertiaryPalette: TonalPalette;
    /**
     * Given a tone, produces a color. Hue and chroma of the
     * color are specified in the design specification of the variant. Usually not
     * colorful at all, intended for background & surface colors.
     */
    readonly neutralPalette: TonalPalette;
    /**
     * Given a tone, produces a color. Hue and chroma
     * of the color are specified in the design specification of the variant.
     * Usually not colorful, but slightly more colorful than Neutral. Intended for
     * backgrounds & surfaces.
     */
    readonly neutralVariantPalette: TonalPalette;
    /**
     * Given a tone, produces a reddish, colorful, color.
     */
    errorPalette: TonalPalette;
    readonly colors: MaterialDynamicColors;
    private static maybeFallbackSpecVersion;
    constructor(args: DynamicSchemeOptions);
    toString(): string;
    /**
     * Returns a new hue based on a piecewise function and input color hue.
     *
     * For example, for the following function:
     * result = 26 if 0 <= hue < 101
     * result = 39 if 101 <= hue < 210
     * result = 28 if 210 <= hue < 360
     *
     * call the function as:
     *
     * const hueBreakpoints = [0, 101, 210, 360];
     * const hues = [26, 39, 28];
     * const result = scheme.piecewise(hue, hueBreakpoints, hues);
     *
     * @param sourceColorHct The input value.
     * @param hueBreakpoints The breakpoints, in sorted order. No default lower or
     *     upper bounds are assumed.
     * @param hues The hues that should be applied when source color's hue is >=
     *     the same index in hueBrakpoints array, and < the hue at the next index
     *     in hueBrakpoints array. Otherwise, the source color's hue is returned.
     */
    static getPiecewiseHue(sourceColorHct: Hct, hueBreakpoints: number[], hues: number[]): number;
    /**
     * Returns a shifted hue based on a piecewise function and input color hue.
     *
     * For example, for the following function:
     * result = hue + 26 if 0 <= hue < 101
     * result = hue - 39 if 101 <= hue < 210
     * result = hue + 28 if 210 <= hue < 360
     *
     * call the function as:
     *
     * const hueBreakpoints = [0, 101, 210, 360];
     * const hues = [26, -39, 28];
     * const result = scheme.getRotatedHue(hue, hueBreakpoints, hues);
     *
     * @param sourceColorHct the source color of the theme, in HCT.
     * @param hueBreakpoints The "breakpoints", i.e. the hues at which a rotation
     *     should be apply. No default lower or upper bounds are assumed.
     * @param rotations The rotation that should be applied when source color's
     *     hue is >= the same index in hues array, and < the hue at the next
     *     index in hues array. Otherwise, the source color's hue is returned.
     */
    static getRotatedHue(sourceColorHct: Hct, hueBreakpoints: number[], rotations: number[]): number;
    getArgb(dynamicColor: DynamicColor): number;
    getHct(dynamicColor: DynamicColor): Hct;
    get primaryPaletteKeyColor(): number;
    get secondaryPaletteKeyColor(): number;
    get tertiaryPaletteKeyColor(): number;
    get neutralPaletteKeyColor(): number;
    get neutralVariantPaletteKeyColor(): number;
    get errorPaletteKeyColor(): number;
    get background(): number;
    get onBackground(): number;
    get surface(): number;
    get surfaceDim(): number;
    get surfaceBright(): number;
    get surfaceContainerLowest(): number;
    get surfaceContainerLow(): number;
    get surfaceContainer(): number;
    get surfaceContainerHigh(): number;
    get surfaceContainerHighest(): number;
    get onSurface(): number;
    get surfaceVariant(): number;
    get onSurfaceVariant(): number;
    get inverseSurface(): number;
    get inverseOnSurface(): number;
    get outline(): number;
    get outlineVariant(): number;
    get shadow(): number;
    get scrim(): number;
    get surfaceTint(): number;
    get primary(): number;
    get primaryDim(): number;
    get onPrimary(): number;
    get primaryContainer(): number;
    get onPrimaryContainer(): number;
    get primaryFixed(): number;
    get primaryFixedDim(): number;
    get onPrimaryFixed(): number;
    get onPrimaryFixedVariant(): number;
    get inversePrimary(): number;
    get secondary(): number;
    get secondaryDim(): number;
    get onSecondary(): number;
    get secondaryContainer(): number;
    get onSecondaryContainer(): number;
    get secondaryFixed(): number;
    get secondaryFixedDim(): number;
    get onSecondaryFixed(): number;
    get onSecondaryFixedVariant(): number;
    get tertiary(): number;
    get tertiaryDim(): number;
    get onTertiary(): number;
    get tertiaryContainer(): number;
    get onTertiaryContainer(): number;
    get tertiaryFixed(): number;
    get tertiaryFixedDim(): number;
    get onTertiaryFixed(): number;
    get onTertiaryFixedVariant(): number;
    get error(): number;
    get errorDim(): number;
    get onError(): number;
    get errorContainer(): number;
    get onErrorContainer(): number;
}
export {};
