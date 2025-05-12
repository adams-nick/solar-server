/**
 * Visualization utilities for SolarScanner data layers
 */

const { createCanvas, Image } = require("canvas");

class VisualizationUtils {
  /**
   * Find building boundaries in mask data
   * @param {TypedArray|Array} maskData - Mask raster data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {Object} options - Options
   * @param {number} [options.margin=0] - Margin to add around boundaries
   * @param {number} [options.threshold=0] - Threshold value for mask (pixels > threshold are buildings)
   * @returns {Object} - Building boundary information
   */
  static findBuildingBoundaries(maskData, width, height, options = {}) {
    try {
      const margin = options.margin ?? 0;
      const threshold = options.threshold ?? 0;

      // Find min/max coordinates where mask value > threshold
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      let foundBuilding = false;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = y * width + x;
          if (maskData[index] > threshold) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            foundBuilding = true;
          }
        }
      }

      // Add margin around the building
      if (foundBuilding) {
        minX = Math.max(0, minX - margin);
        minY = Math.max(0, minY - margin);
        maxX = Math.min(width - 1, maxX + margin);
        maxY = Math.min(height - 1, maxY + margin);
      } else {
        console.warn("No building found in mask data");
        // Default to full image
        minX = 0;
        minY = 0;
        maxX = width - 1;
        maxY = height - 1;
      }

      return {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        hasBuilding: foundBuilding,
      };
    } catch (error) {
      console.error(`Error finding building boundaries: ${error.message}`);
      // Return default values covering the whole image
      return {
        minX: 0,
        maxX: width - 1,
        minY: 0,
        maxY: height - 1,
        width: width,
        height: height,
        hasBuilding: false,
        error: error.message,
      };
    }
  }

  /**
   * Crop raster data to specified boundaries
   * @param {TypedArray|Array} data - Raster data
   * @param {number} width - Original width
   * @param {number} height - Original height
   * @param {Object} boundaries - Boundaries object from findBuildingBoundaries
   * @returns {Object} - Cropped data with new dimensions
   */
  static cropData(data, width, height, boundaries) {
    try {
      const { minX, minY, width: newWidth, height: newHeight } = boundaries;

      // Create a new array for the cropped data
      const croppedData = new Array(newWidth * newHeight);

      // Copy the data from the original array to the cropped array
      for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
          const srcIdx = (minY + y) * width + (minX + x);
          const destIdx = y * newWidth + x;
          croppedData[destIdx] = data[srcIdx];
        }
      }

      return {
        data: croppedData,
        width: newWidth,
        height: newHeight,
      };
    } catch (error) {
      console.error(`Error cropping data: ${error.message}`);
      // Return the original data
      return {
        data,
        width,
        height,
        error: error.message,
      };
    }
  }

  /**
   * Resize image dimensions while maintaining aspect ratio
   * @param {number} width - Original width
   * @param {number} height - Original height
   * @param {Object} options - Resize options
   * @param {number} [options.maxWidth] - Maximum width
   * @param {number} [options.maxHeight] - Maximum height
   * @param {number} [options.maxDimension] - Maximum dimension (width or height)
   * @returns {Object} - New dimensions {width, height}
   */
  static resizeDimensions(width, height, options = {}) {
    try {
      let newWidth = width;
      let newHeight = height;
      const aspectRatio = width / height;

      // Apply maxDimension if specified
      if (options.maxDimension) {
        if (width > height && width > options.maxDimension) {
          newWidth = options.maxDimension;
          newHeight = Math.round(newWidth / aspectRatio);
        } else if (height > options.maxDimension) {
          newHeight = options.maxDimension;
          newWidth = Math.round(newHeight * aspectRatio);
        }
      }

      // Apply maxWidth if specified
      if (options.maxWidth && newWidth > options.maxWidth) {
        newWidth = options.maxWidth;
        newHeight = Math.round(newWidth / aspectRatio);
      }

      // Apply maxHeight if specified
      if (options.maxHeight && newHeight > options.maxHeight) {
        newHeight = options.maxHeight;
        newWidth = Math.round(newHeight * aspectRatio);
      }

      // Ensure minimum dimensions
      newWidth = Math.max(1, Math.round(newWidth));
      newHeight = Math.max(1, Math.round(newHeight));

      return { width: newWidth, height: newHeight };
    } catch (error) {
      console.error(`Error resizing dimensions: ${error.message}`);
      // Return the original dimensions
      return { width, height, error: error.message };
    }
  }

  /**
   * Get seasonal adjustment factor for visualization
   * @param {number} month - Month index (0-11, where 0 is January)
   * @returns {number} - Seasonal factor (0-1)
   */
  static getSeasonalFactor(month) {
    try {
      // Normalize month index to 0-11 range
      const normalizedMonth = ((month % 12) + 12) % 12;

      // Northern hemisphere seasonal pattern
      const factors = [
        0.4, // January
        0.5, // February
        0.65, // March
        0.8, // April
        0.9, // May
        1.0, // June
        1.0, // July
        0.9, // August
        0.8, // September
        0.65, // October
        0.5, // November
        0.4, // December
      ];

      return factors[normalizedMonth];
    } catch (error) {
      console.error(`Error getting seasonal factor: ${error.message}`);
      return 0.7; // Default middle value
    }
  }

  /**
   * Apply mask to data (set non-mask areas to null/undefined/NaN)
   * @param {TypedArray|Array} maskData - Mask raster data
   * @param {TypedArray|Array} valueData - Value raster data
   * @param {number} width - Width of both rasters
   * @param {number} height - Height of both rasters
   * @param {Object} options - Options
   * @param {number} [options.threshold=0] - Threshold value for mask
   * @param {*} [options.nullValue=NaN] - Value to use for non-mask areas
   * @returns {Array} - Masked data
   */
  static applyMaskToData(maskData, valueData, width, height, options = {}) {
    try {
      const threshold = options.threshold ?? 0;
      const nullValue = options.nullValue ?? NaN;

      // Create a new array for the masked data
      const maskedData = new Array(width * height);

      // Apply mask
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = y * width + x;

          // If mask value is above threshold, use value data; otherwise, use null value
          maskedData[index] =
            maskData[index] > threshold ? valueData[index] : nullValue;
        }
      }

      return maskedData;
    } catch (error) {
      console.error(`Error applying mask to data: ${error.message}`);
      // Return the original data
      return valueData;
    }
  }

  /**
   * Create a canvas and draw raster data using a color palette
   * @param {Array} data - Raster data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {Array} palette - Color palette (array of {r,g,b} objects)
   * @param {Object} options - Visualization options
   * @param {number} [options.min] - Minimum data value (for normalization)
   * @param {number} [options.max] - Maximum data value (for normalization)
   * @param {boolean} [options.useAlpha=true] - Use alpha channel for null values
   * @returns {HTMLCanvasElement} - Canvas element
   */
  static createCanvas(data, width, height, palette, options = {}) {
    try {
      // Create canvas
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // Create image data
      const imageData = ctx.createImageData(width, height);

      // Determine value range for normalization
      const min = options.min !== undefined ? options.min : 0;
      const max = options.max !== undefined ? options.max : 1;
      const noDataValue =
        options.noDataValue !== undefined ? options.noDataValue : -9999;
      const useAlpha = options.useAlpha !== false;

      // Fill image data
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = y * width + x;
          const pixelIndex = index * 4;

          const value = data[index];

          // Check if this is a valid data point
          const isValid =
            value !== noDataValue &&
            value !== undefined &&
            value !== null &&
            !isNaN(value) &&
            isFinite(value);

          if (isValid) {
            // Normalize value to 0-1 range with safety bounds
            const normalizedValue = Math.max(
              0,
              Math.min(1, (value - min) / (max - min))
            );

            // Map to color palette
            const colorIndex = Math.max(
              0,
              Math.min(
                palette.length - 1,
                Math.floor(normalizedValue * (palette.length - 1))
              )
            );
            const color = palette[colorIndex];

            // Set RGB values
            imageData.data[pixelIndex] = color.r;
            imageData.data[pixelIndex + 1] = color.g;
            imageData.data[pixelIndex + 2] = color.b;
            imageData.data[pixelIndex + 3] = 255; // Fully opaque
          } else {
            // No-data or invalid value
            imageData.data[pixelIndex] = 0;
            imageData.data[pixelIndex + 1] = 0;
            imageData.data[pixelIndex + 2] = 0;
            imageData.data[pixelIndex + 3] = useAlpha ? 0 : 255; // Transparent if using alpha
          }
        }
      }

      // Put the image data on the canvas
      ctx.putImageData(imageData, 0, 0);

      return canvas;
    } catch (error) {
      console.error(`Error creating canvas: ${error.message}`);
      console.error(error.stack);

      // Create fallback canvas
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // Fill with error pattern
      ctx.fillStyle = "#f8f8f8";
      ctx.fillRect(0, 0, width, height);

      return canvas;
    }
  }

  /**
   * Create a PNG data URL from canvas
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {Object} options - Options
   * @param {string} [options.mimeType='image/png'] - MIME type
   * @param {number} [options.quality=0.92] - Quality (for JPEG)
   * @returns {string} - Data URL
   */
  static canvasToDataURL(canvas, options = {}) {
    try {
      const mimeType = options.mimeType || "image/png";
      const quality = options.quality || 0.92;

      return canvas.toDataURL(mimeType, quality);
    } catch (error) {
      console.error(`Error converting canvas to data URL: ${error.message}`);
      return ""; // Empty string on error
    }
  }

  /**
   * Create a synthetic visualization when real data is unavailable
   * @param {number} width - Width
   * @param {number} height - Height
   * @param {number} month - Month index (0-11)
   * @param {Object} location - Location {latitude, longitude}
   * @param {Array} palette - Color palette (array of {r,g,b} objects)
   * @returns {string} - Data URL
   */
  static createSyntheticVisualization(width, height, month, location, palette) {
    try {
      // Create canvas
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // Make the background fully transparent
      ctx.clearRect(0, 0, width, height);

      // Get seasonal factor
      const seasonalFactor = this.getSeasonalFactor(month);

      // Create pseudorandom function based on location
      let seed = 12345;
      if (location && location.latitude && location.longitude) {
        seed = Math.abs(location.latitude * 1000 + location.longitude * 1000);
      }

      const pseudoRandom = (s) => {
        const x = Math.sin(s) * 10000;
        return x - Math.floor(x);
      };

      // Center coordinates
      const centerX = width / 2;
      const centerY = height / 2;

      // Determine roof type based on location seed
      const roofType = Math.floor(pseudoRandom(seed) * 3) + 1;

      // Create roof shape
      let roofPolygon;

      switch (roofType) {
        case 1: // Rectangle
          const roofWidth = width * 0.9;
          const roofHeight = height * 0.9;
          roofPolygon = [
            { x: centerX - roofWidth / 2, y: centerY - roofHeight / 2 },
            { x: centerX + roofWidth / 2, y: centerY - roofHeight / 2 },
            { x: centerX + roofWidth / 2, y: centerY + roofHeight / 2 },
            { x: centerX - roofWidth / 2, y: centerY + roofHeight / 2 },
          ];
          break;

        case 2: // L-shape
          const mainWidth = width * 0.85;
          const mainHeight = height * 0.85;
          const wingWidth = mainWidth * 0.7;
          const wingHeight = mainHeight * 0.6;

          roofPolygon = [
            { x: centerX - mainWidth / 2, y: centerY - mainHeight / 2 },
            { x: centerX + mainWidth / 2, y: centerY - mainHeight / 2 },
            {
              x: centerX + mainWidth / 2,
              y: centerY + wingHeight - mainHeight / 2,
            },
            {
              x: centerX - mainWidth / 2 + wingWidth,
              y: centerY + wingHeight - mainHeight / 2,
            },
            {
              x: centerX - mainWidth / 2 + wingWidth,
              y: centerY + mainHeight / 2,
            },
            { x: centerX - mainWidth / 2, y: centerY + mainHeight / 2 },
          ];
          break;

        case 3: // Complex polygon
        default:
          const segments = 5 + Math.floor(pseudoRandom(seed + 1) * 4);
          roofPolygon = [];

          for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const radius = width * 0.4 * (0.85 + pseudoRandom(seed + i) * 0.15);
            roofPolygon.push({
              x: centerX + Math.cos(angle) * radius,
              y: centerY + Math.sin(angle) * radius,
            });
          }
          break;
      }

      // Draw the roof shape
      ctx.beginPath();
      ctx.moveTo(roofPolygon[0].x, roofPolygon[0].y);
      for (let i = 1; i < roofPolygon.length; i++) {
        ctx.lineTo(roofPolygon[i].x, roofPolygon[i].y);
      }
      ctx.closePath();

      // Create gradient for base color
      const baseGradient = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        width * 0.5
      );

      // Middle of palette for base color
      const midPalette = Math.floor(palette.length * 0.5);
      const baseColor = palette[midPalette];

      baseGradient.addColorStop(
        0,
        `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, 0.9)`
      );
      baseGradient.addColorStop(
        1,
        `rgba(${baseColor.r * 0.7}, ${baseColor.g * 0.7}, ${
          baseColor.b * 0.7
        }, 0.9)`
      );

      ctx.fillStyle = baseGradient;
      ctx.fill();

      // Create roof planes with different intensities
      ctx.save();
      ctx.clip(); // Clip to the roof shape

      const segments = 2 + Math.floor(pseudoRandom(seed + 5) * 4);
      const segmentWidth = width / segments;

      // Draw roof segments with varying intensity
      for (let s = 0; s < segments; s++) {
        const segX = s * segmentWidth + segmentWidth / 2;
        const intensity =
          0.5 + pseudoRandom(seed + s * 10) * 0.5 * seasonalFactor;

        // Create segment gradient
        const colorIndex = Math.floor(intensity * (palette.length - 1));
        const color = palette[colorIndex];

        const segmentGradient = ctx.createLinearGradient(
          segX - segmentWidth / 2,
          0,
          segX + segmentWidth / 2,
          0
        );

        segmentGradient.addColorStop(
          0,
          `rgba(${color.r * 0.9}, ${color.g * 0.9}, ${color.b * 0.9}, 0.7)`
        );
        segmentGradient.addColorStop(
          0.5,
          `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`
        );
        segmentGradient.addColorStop(
          1,
          `rgba(${color.r * 0.9}, ${color.g * 0.9}, ${color.b * 0.9}, 0.7)`
        );

        ctx.fillStyle = segmentGradient;
        ctx.fillRect(segX - segmentWidth / 2, 0, segmentWidth, height);
      }

      // Add hotspots
      const hotspotCount = 3 + Math.floor(pseudoRandom(seed + 20) * 5);

      for (let h = 0; h < hotspotCount; h++) {
        const hx = centerX + (pseudoRandom(seed + h * 5) - 0.5) * width * 0.7;
        const hy = centerY + (pseudoRandom(seed + h * 7) - 0.5) * height * 0.7;
        const radius = 30 + pseudoRandom(seed + h * 11) * 70;

        // Higher intensity for hotspots
        const intensity =
          0.7 + pseudoRandom(seed + h * 13) * 0.3 * seasonalFactor;
        const colorIndex = Math.floor(intensity * (palette.length - 1));
        const color = palette[colorIndex];

        const hotspotGradient = ctx.createRadialGradient(
          hx,
          hy,
          0,
          hx,
          hy,
          radius
        );

        hotspotGradient.addColorStop(
          0,
          `rgba(${color.r}, ${color.g}, ${color.b}, 0.9)`
        );
        hotspotGradient.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.fillStyle = hotspotGradient;
        ctx.fillRect(hx - radius, hy - radius, radius * 2, radius * 2);
      }

      // Add grid pattern
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;

      const gridSpacing = 10 + Math.floor(pseudoRandom(seed + 30) * 15);

      // Vertical lines
      for (let x = 0; x < width; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Horizontal lines
      for (let y = 0; y < height; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      ctx.restore(); // Remove clipping

      // Add roof edge highlight
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(roofPolygon[0].x, roofPolygon[0].y);
      for (let i = 1; i < roofPolygon.length; i++) {
        ctx.lineTo(roofPolygon[i].x, roofPolygon[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      return canvas.toDataURL("image/png");
    } catch (error) {
      console.error(`Error creating synthetic visualization: ${error.message}`);

      // Create a simple fallback
      try {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        // Fill with a simple gradient
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "rgba(100, 100, 200, 0.6)");
        gradient.addColorStop(1, "rgba(200, 100, 100, 0.6)");

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Add error text
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.font = "16px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Visualization unavailable", width / 2, height / 2);

        return canvas.toDataURL("image/png");
      } catch (fallbackError) {
        console.error(
          `Error creating fallback visualization: ${fallbackError.message}`
        );
        return "";
      }
    }
  }
}

module.exports = VisualizationUtils;
