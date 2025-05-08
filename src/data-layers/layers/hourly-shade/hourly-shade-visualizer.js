/**
 * Hourly shade layer visualizer for SolarScanner data-layers module
 */

const Visualizer = require("../../core/visualizer");
const ColorPalettes = require("../../utils/color-palettes");
const config = require("../../config");

/**
 * Visualizer implementation for hourly shade layer data
 * @extends Visualizer
 */
class HourlyShadeVisualizer extends Visualizer {
  /**
   * Create a new HourlyShadeVisualizer
   */
  constructor() {
    super();
    console.log("[HourlyShadeVisualizer] Initialized");
  }

  /**
   * Check if this visualizer can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this processor can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "hourlyShade";
  }

  /**
   * Create visualizations from processed hourly shade data
   * @param {Object} processedData - The processed hourly shade data
   * @param {Object} options - Visualization options
   * @returns {Promise<Object>} - Object with buildingFocus and fullImage visualization URLs
   */
  async visualize(processedData, options = {}) {
    try {
      return await this.timeOperation("visualize", async () => {
        // Validate processed data
        if (!processedData) {
          throw new Error("No processed data provided for visualization");
        }

        this.validateProcessedData(processedData, ["metadata", "hourlyData"]);

        // Get data from processed result
        const { metadata, hourlyData, buildingBoundaries, maskRaster } =
          processedData;
        const { width, height } = metadata.dimensions || metadata;
        const maskDimensions = metadata.maskDimensions;

        // Set visualization options
        const maxDimension =
          options.maxDimension || config.visualization.MAX_DIMENSION;

        // Determine if we're visualizing a specific hour or all hours
        const specificHour = options.hour !== undefined;
        const hourIndex = specificHour ? options.hour : null;

        // Determine the color palette
        let palette;
        if (options.palette) {
          palette = options.palette;
        } else {
          const paletteName = options.paletteName || "SUNLIGHT";
          palette = ColorPalettes.getPalette(paletteName);
        }

        // Prepare result arrays
        const buildingFocusVisualizations = [];
        const fullImageVisualizations = [];

        // Filter hours to process
        const hoursToProcess = specificHour
          ? [hourlyData.find((h) => h.hour === hourIndex) || hourlyData[0]]
          : hourlyData;

        // Process each hour
        for (const hourData of hoursToProcess) {
          try {
            // Get the raster data for this hour
            const shadeRaster = hourData.raster;

            // First create full image visualization
            const fullImageDataUrl = await this.createHourVisualization(
              shadeRaster,
              width,
              height,
              maskRaster,
              null, // No building boundaries for full image
              palette,
              maxDimension,
              false, // Not building focused
              maskDimensions
            );

            fullImageVisualizations.push({
              hour: hourData.hour,
              hourLabel: hourData.hourLabel,
              dataUrl: fullImageDataUrl,
            });

            // Then create building-focused visualization
            let buildingFocusDataUrl;
            if (buildingBoundaries?.hasBuilding) {
              buildingFocusDataUrl = await this.createHourVisualization(
                shadeRaster,
                width,
                height,
                maskRaster,
                buildingBoundaries,
                palette,
                maxDimension,
                true, // Building focused
                maskDimensions
              );
            } else {
              // If no building boundaries, use the full image
              buildingFocusDataUrl = fullImageDataUrl;
            }

            buildingFocusVisualizations.push({
              hour: hourData.hour,
              hourLabel: hourData.hourLabel,
              dataUrl: buildingFocusDataUrl,
            });
          } catch (error) {
            console.error(
              `[HourlyShadeVisualizer] Error processing hour ${hourData.hour}: ${error.message}`
            );
            throw error;
          }
        }

        // Return result based on request type
        if (specificHour) {
          return {
            buildingFocus: buildingFocusVisualizations[0]?.dataUrl,
            fullImage: fullImageVisualizations[0]?.dataUrl,
          };
        } else {
          return {
            buildingFocus: buildingFocusVisualizations.map((v) => v.dataUrl),
            fullImage: fullImageVisualizations.map((v) => v.dataUrl),
          };
        }
      });
    } catch (error) {
      // Create a well-formatted error
      const enhancedError = new Error(
        `Failed to visualize hourly shade data: ${error.message}`
      );
      enhancedError.originalError = error;
      enhancedError.layerType = "hourlyShade";
      throw enhancedError;
    }
  }

  /**
   * Create a visualization for a single hour
   * @private
   * @param {Array<number>} shadeRaster - Shade raster data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {Array<number>} maskRaster - Mask raster data (optional)
   * @param {Object} buildingBoundaries - Building boundaries object (optional)
   * @param {Array<Object>} palette - Color palette
   * @param {number} maxDimension - Maximum dimension for output image
   * @param {boolean} buildingFocus - Whether to focus on building boundaries
   * @param {Object} maskDimensions - Dimensions of the mask (optional)
   * @returns {Promise<string>} - Data URL of the visualization
   */
  async createHourVisualization(
    shadeRaster,
    width,
    height,
    maskRaster,
    buildingBoundaries,
    palette,
    maxDimension,
    buildingFocus,
    maskDimensions
  ) {
    // Determine dimensions for output - for building focus, use mask dimensions
    let targetWidth = width;
    let targetHeight = height;

    // For building focus with mask, use the mask dimensions for upscaling
    if (buildingFocus && maskRaster && maskDimensions) {
      targetWidth = maskDimensions.width;
      targetHeight = maskDimensions.height;
    }

    // Scale up the hourly shade data to match target dimensions if needed
    let processedShadeRaster = shadeRaster;
    if (buildingFocus && (width !== targetWidth || height !== targetHeight)) {
      processedShadeRaster = this.scaleUpRaster(
        shadeRaster,
        width,
        height,
        targetWidth,
        targetHeight
      );
    }

    // Determine dimensions and cropping
    let outputWidth, outputHeight, startX, startY;
    let croppedData;

    // If building focus with boundaries, crop to building area
    if (buildingFocus && buildingBoundaries?.hasBuilding) {
      const { minX, minY, width: bWidth, height: bHeight } = buildingBoundaries;
      startX = minX;
      startY = minY;
      outputWidth = bWidth;
      outputHeight = bHeight;

      // Create cropped data array from the upscaled raster
      croppedData = new Array(outputWidth * outputHeight);
      for (let y = 0; y < outputHeight; y++) {
        for (let x = 0; x < outputWidth; x++) {
          const srcIdx = (startY + y) * targetWidth + (startX + x);
          const destIdx = y * outputWidth + x;
          croppedData[destIdx] = processedShadeRaster[srcIdx];
        }
      }
    } else {
      // Use full image
      startX = 0;
      startY = 0;
      outputWidth = buildingFocus ? targetWidth : width;
      outputHeight = buildingFocus ? targetHeight : height;
      croppedData = buildingFocus ? processedShadeRaster : shadeRaster;
    }

    // Apply max dimension limit if needed
    let scaledWidth = outputWidth;
    let scaledHeight = outputHeight;

    if (outputWidth > maxDimension || outputHeight > maxDimension) {
      const aspectRatio = outputWidth / outputHeight;
      if (outputWidth > outputHeight) {
        scaledWidth = maxDimension;
        scaledHeight = Math.round(maxDimension / aspectRatio);
      } else {
        scaledHeight = maxDimension;
        scaledWidth = Math.round(maxDimension * aspectRatio);
      }
    }

    // Create a mask array for cropping if needed
    let croppedMaskRaster = null;
    if (maskRaster && buildingFocus && buildingBoundaries?.hasBuilding) {
      croppedMaskRaster = new Array(outputWidth * outputHeight);
      for (let y = 0; y < outputHeight; y++) {
        for (let x = 0; x < outputWidth; x++) {
          const srcIdx = (startY + y) * targetWidth + (startX + x);
          const destIdx = y * outputWidth + x;
          croppedMaskRaster[destIdx] = maskRaster[srcIdx];
        }
      }
    }

    // Create canvas and context
    const { canvas, ctx } = this.createEmptyCanvas(scaledWidth, scaledHeight);

    // Create image data
    const imageData = ctx.createImageData(scaledWidth, scaledHeight);

    // Count transparent and opaque pixels for debugging
    let transparentPixels = 0;
    let opaquePixels = 0;

    // Fill the image data
    for (let y = 0; y < scaledHeight; y++) {
      for (let x = 0; x < scaledWidth; x++) {
        // Calculate source coordinates (with scaling)
        const srcX = Math.min(
          Math.floor(x * (outputWidth / scaledWidth)),
          outputWidth - 1
        );
        const srcY = Math.min(
          Math.floor(y * (outputHeight / scaledHeight)),
          outputHeight - 1
        );
        const srcIdx = srcY * outputWidth + srcX;

        const destIdx = (y * scaledWidth + x) * 4;

        // Get shade value (0 = shade, 1 = sun)
        const shadeValue = croppedData[srcIdx];

        // Apply mask if available
        const useMask = buildingFocus && croppedMaskRaster;
        const maskValue = useMask ? croppedMaskRaster[srcIdx] : 0;
        const isMasked = useMask && maskValue > 0;

        // Set color based on shade value
        const colorIndex = shadeValue ? palette.length - 1 : 0;
        const color = palette[colorIndex];

        imageData.data[destIdx] = color.r; // Red
        imageData.data[destIdx + 1] = color.g; // Green
        imageData.data[destIdx + 2] = color.b; // Blue

        // Set alpha (transparency)
        if (useMask) {
          // Set transparency based on mask
          imageData.data[destIdx + 3] = isMasked ? 255 : 0; // Transparent if not in mask
          if (isMasked) {
            opaquePixels++;
          } else {
            transparentPixels++;
          }
        } else {
          imageData.data[destIdx + 3] = 255; // Fully opaque
          opaquePixels++;
        }
      }
    }

    // Put the image data on the canvas
    ctx.putImageData(imageData, 0, 0);

    // Convert canvas to data URL
    const dataUrl = this.canvasToDataURL(canvas, {
      mimeType: "image/png",
      quality: config.visualization.PNG_QUALITY,
    });

    return dataUrl;
  }

  /**
   * Scale up a raster to higher dimensions
   * @private
   * @param {Array<number>} raster - Original raster data
   * @param {number} sourceWidth - Original width
   * @param {number} sourceHeight - Original height
   * @param {number} targetWidth - Target width
   * @param {number} targetHeight - Target height
   * @returns {Array<number>} - Scaled raster
   */
  scaleUpRaster(raster, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scaledRaster = new Array(targetWidth * targetHeight);

    // Calculate scaling factors
    const scaleX = sourceWidth / targetWidth;
    const scaleY = sourceHeight / targetHeight;

    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        // Find corresponding position in source raster (nearest neighbor)
        const srcX = Math.min(Math.floor(x * scaleX), sourceWidth - 1);
        const srcY = Math.min(Math.floor(y * scaleY), sourceHeight - 1);
        const srcIdx = srcY * sourceWidth + srcX;

        // Set the value in the scaled raster
        const destIdx = y * targetWidth + x;
        scaledRaster[destIdx] = raster[srcIdx];
      }
    }

    return scaledRaster;
  }

  /**
   * Format hour for display (12-hour format with am/pm)
   * @private
   * @param {number} hour - Hour in 24-hour format (0-23)
   * @returns {string} - Formatted hour string
   */
  formatHour(hour) {
    if (hour === 0) return "12am";
    if (hour === 12) return "12pm";
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  }
}

module.exports = HourlyShadeVisualizer;
