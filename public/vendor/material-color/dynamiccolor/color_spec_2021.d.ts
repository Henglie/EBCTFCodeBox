/**
 * @license
 * Copyright 2025 Google LLC
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
import { ColorSpecDelegate } from './color_spec.js';
import { DynamicColor } from './dynamic_color.js';
import type { DynamicScheme } from './dynamic_scheme';
/**
 * A delegate for the dynamic color spec of a DynamicScheme in the 2021 spec.
 */
export declare class ColorSpecDelegateImpl2021 implements ColorSpecDelegate {
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
    inverseSurface(): DynamicColor;
    inverseOnSurface(): DynamicColor;
    outline(): DynamicColor;
    outlineVariant(): DynamicColor;
    shadow(): DynamicColor;
    scrim(): DynamicColor;
    surfaceTint(): DynamicColor;
    primary(): DynamicColor;
    primaryDim(): DynamicColor | undefined;
    onPrimary(): DynamicColor;
    primaryContainer(): DynamicColor;
    onPrimaryContainer(): DynamicColor;
    inversePrimary(): DynamicColor;
    secondary(): DynamicColor;
    secondaryDim(): DynamicColor | undefined;
    onSecondary(): DynamicColor;
    secondaryContainer(): DynamicColor;
    onSecondaryContainer(): DynamicColor;
    tertiary(): DynamicColor;
    tertiaryDim(): DynamicColor | undefined;
    onTertiary(): DynamicColor;
    tertiaryContainer(): DynamicColor;
    onTertiaryContainer(): DynamicColor;
    error(): DynamicColor;
    errorDim(): DynamicColor | undefined;
    onError(): DynamicColor;
    errorContainer(): DynamicColor;
    onErrorContainer(): DynamicColor;
    primaryFixed(): DynamicColor;
    primaryFixedDim(): DynamicColor;
    onPrimaryFixed(): DynamicColor;
    onPrimaryFixedVariant(): DynamicColor;
    secondaryFixed(): DynamicColor;
    secondaryFixedDim(): DynamicColor;
    onSecondaryFixed(): DynamicColor;
    onSecondaryFixedVariant(): DynamicColor;
    tertiaryFixed(): DynamicColor;
    tertiaryFixedDim(): DynamicColor;
    onTertiaryFixed(): DynamicColor;
    onTertiaryFixedVariant(): DynamicColor;
    highestSurface(s: DynamicScheme): DynamicColor;
}
