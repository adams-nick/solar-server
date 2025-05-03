/**
 * Color palette utilities for SolarScanner data layer visualizations
 */
class ColorPalettes {
  /**
   * Predefined color palettes for visualizing different data layer types
   */
  static get PALETTES() {
    return {
      // Iron palette - good for flux/solar intensity visualization
      IRON: [
        "00000a",
        "120d30",
        "251356",
        "38197c",
        "4b2079",
        "5e2876",
        "713072",
        "83376e",
        "96406a",
        "a84866",
        "bb5062",
        "cf595e",
        "e2615a",
        "f66b4d",
        "ff7e3c",
        "ff932a",
        "ffa813",
        "ffbf00",
        "ffd700",
        "fff0bf",
        "fffff6",
      ],

      // Binary palette - good for mask visualization
      BINARY: ["212121", "B3E5FC"],

      // Rainbow palette - good for DSM (Digital Surface Model) visualization
      RAINBOW: ["3949AB", "81D4FA", "66BB6A", "FFE082", "E53935"],

      // Sunlight palette - good for hourly shade visualization
      SUNLIGHT: ["212121", "FFCA28"],

      // Panels palette - for visualizing solar panel layouts
      PANELS: ["E8EAF6", "1A237E"],
    };
  }

  /**
   * Convert hex color to RGB
   * @param {string} hex - Hex color code (with or without # prefix)
   * @returns {Object} - RGB object {r, g, b}
   * @throws {Error} - If invalid hex color is provided
   */
  static hexToRgb(hex) {
    try {
      // Remove # if present
      const cleanHex = hex.startsWith("#") ? hex.slice(1) : hex;

      if (cleanHex.length !== 6) {
        throw new Error(`Invalid hex color length: ${hex}`);
      }

      const r = parseInt(cleanHex.substring(0, 2), 16);
      const g = parseInt(cleanHex.substring(2, 4), 16);
      const b = parseInt(cleanHex.substring(4, 6), 16);

      // Validate the results
      if (isNaN(r) || isNaN(g) || isNaN(b)) {
        throw new Error(`Invalid hex color format: ${hex}`);
      }

      return { r, g, b };
    } catch (error) {
      console.error(`Error converting hex to RGB: ${error.message}`);
      // Return black as a fallback
      return { r: 0, g: 0, b: 0 };
    }
  }

  /**
   * Linear interpolation between two values
   * @param {number} start - Start value
   * @param {number} end - End value
   * @param {number} t - Interpolation factor (0-1)
   * @returns {number} - Interpolated value
   */
  static lerp(start, end, t) {
    // Clamp t to 0-1 range for safety
    const clampedT = Math.max(0, Math.min(1, t));
    return start + clampedT * (end - start);
  }

  /**
   * Create a color palette with interpolated values
   * @param {Array<string>} hexColors - Array of hex color codes
   * @param {number} size - Number of colors in the palette (default: 256)
   * @returns {Array<Object>} - Array of RGB color objects
   * @throws {Error} - If invalid input is provided
   */
  static createPalette(hexColors, size = 256) {
    try {
      if (!Array.isArray(hexColors) || hexColors.length < 2) {
        throw new Error("At least two colors are required to create a palette");
      }

      if (size < 2) {
        throw new Error("Palette size must be at least 2");
      }

      const colors = hexColors.map(this.hexToRgb);
      const step = (colors.length - 1) / (size - 1);

      return Array(size)
        .fill(0)
        .map((_, i) => {
          const index = i * step;
          const lower = Math.floor(index);
          const upper = Math.min(Math.ceil(index), colors.length - 1);
          const t = index - lower;

          return {
            r: Math.round(this.lerp(colors[lower].r, colors[upper].r, t)),
            g: Math.round(this.lerp(colors[lower].g, colors[upper].g, t)),
            b: Math.round(this.lerp(colors[lower].b, colors[upper].b, t)),
          };
        });
    } catch (error) {
      console.error(`Error creating palette: ${error.message}`);
      // Return a simple grayscale palette as fallback
      return Array(size)
        .fill(0)
        .map((_, i) => {
          const value = Math.round((i / (size - 1)) * 255);
          return { r: value, g: value, b: value };
        });
    }
  }

  /**
   * Get a palette by name
   * @param {string} name - Palette name (case insensitive)
   * @param {number} size - Number of colors in the palette (default: 256)
   * @returns {Array<Object>} - Array of RGB color objects
   * @throws {Error} - If palette name is not found
   */
  static getPalette(name, size = 256) {
    try {
      const upperName = name.toUpperCase();
      const hexColors = this.PALETTES[upperName];

      if (!hexColors) {
        throw new Error(`Unknown palette: ${name}`);
      }

      return this.createPalette(hexColors, size);
    } catch (error) {
      console.error(`Error getting palette: ${error.message}`);
      // Return a simple grayscale palette as fallback
      console.warn(`Falling back to grayscale palette`);
      return Array(size)
        .fill(0)
        .map((_, i) => {
          const value = Math.round((i / (size - 1)) * 255);
          return { r: value, g: value, b: value };
        });
    }
  }

  /**
   * Convert RGB color to hex string
   * @param {Object} color - RGB color object {r, g, b}
   * @param {boolean} includeHash - Whether to include # prefix (default: false)
   * @returns {string} - Hex color code
   */
  static rgbToHex(color, includeHash = false) {
    try {
      const { r, g, b } = color;

      // Ensure values are in valid range
      const validR = Math.max(0, Math.min(255, Math.round(r)));
      const validG = Math.max(0, Math.min(255, Math.round(g)));
      const validB = Math.max(0, Math.min(255, Math.round(b)));

      const hex = [
        validR.toString(16).padStart(2, "0"),
        validG.toString(16).padStart(2, "0"),
        validB.toString(16).padStart(2, "0"),
      ].join("");

      return includeHash ? `#${hex}` : hex;
    } catch (error) {
      console.error(`Error converting RGB to hex: ${error.message}`);
      return includeHash ? "#000000" : "000000";
    }
  }

  /**
   * Create a CSS-compatible gradient string from a palette
   * @param {string} paletteName - Name of the palette
   * @param {string} direction - CSS gradient direction (default: 'to right')
   * @returns {string} - CSS linear-gradient value
   */
  static getCssGradient(paletteName, direction = "to right") {
    try {
      const hexColors = this.PALETTES[paletteName.toUpperCase()];

      if (!hexColors) {
        throw new Error(`Unknown palette: ${paletteName}`);
      }

      const colorStops = hexColors
        .map((hex, index) => {
          const percentage = (index / (hexColors.length - 1)) * 100;
          return `#${hex} ${percentage}%`;
        })
        .join(", ");

      return `linear-gradient(${direction}, ${colorStops})`;
    } catch (error) {
      console.error(`Error creating CSS gradient: ${error.message}`);
      return "linear-gradient(to right, #000000, #ffffff)";
    }
  }
}

module.exports = ColorPalettes;
