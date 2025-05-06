/**
 * Hourly shade layer visualizer for SolarScanner data-layers module
 *
 * Creates visualizations from processed hourly shade data, showing shadow patterns
 * for each hour of the day.
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
   * @returns {boolean} - True if this visualizer can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "hourlyShade";
  }

  /**
   * Create visualizations from processed hourly shade data
   * @param {Object} processedData - The processed hourly shade data
   * @param {Object} options - Visualization options
   * @param {boolean} [options.buildingFocus=true] - Whether to focus on building boundaries
   * @param {number} [options.maxDimension=400] - Maximum dimension for the output image
   * @param {Array<Object>} [options.palette] - Custom color palette to use
   * @param {string} [options.paletteName='SUNLIGHT'] - Name of predefined palette to use
   * @param {number} [options.hour] - Specific hour to visualize (0-23), null for all hours
   * @returns {Promise<Array<string>|string>} - Array of data URLs for all hours or single URL
   * @throws {Error} if visualization fails
   */
  async visualize(processedData, options = {}) {
    try {
      return await this.timeOperation("visualize", async () => {
        console.log(
          "[HourlyShadeVisualizer] Creating visualization(s) from hourly shade data"
        );

        // Validate processed data
        this.validateProcessedData(processedData, ["metadata", "hourlyData"]);

        // Get data from processed result
        const { metadata, hourlyData, buildingBoundaries, maskRaster } =
          processedData;
        const { width, height } = metadata.dimensions || metadata;

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

        // Prepare result arrays - one for building focus, one for full image
        const buildingFocusVisualizations = [];
        const fullImageVisualizations = [];

        // Filter hours to process
        const hoursToProcess = specificHour
          ? [hourlyData.find((h) => h.hour === hourIndex) || hourlyData[0]]
          : hourlyData;

        // Process each hour
        for (const hourData of hoursToProcess) {
          try {
            console.log(
              `[HourlyShadeVisualizer] Processing visualization for ${hourData.hourLabel}`
            );

            // Get the raster data for this hour
            const shadeRaster = hourData.raster;

            // First create full image visualization
            // ---------------
            const fullImageDataUrl = await this.createHourVisualization(
              shadeRaster,
              width,
              height,
              maskRaster,
              null, // No building boundaries for full image
              palette,
              maxDimension,
              false // Not building focused
            );

            fullImageVisualizations.push({
              hour: hourData.hour,
              hourLabel: hourData.hourLabel,
              dataUrl: fullImageDataUrl,
              synthetic: false,
            });

            // Then create building-focused visualization if building boundaries exist
            // ---------------
            if (buildingBoundaries?.hasBuilding) {
              const buildingFocusDataUrl = await this.createHourVisualization(
                shadeRaster,
                width,
                height,
                maskRaster,
                buildingBoundaries,
                palette,
                maxDimension,
                true // Building focused
              );

              buildingFocusVisualizations.push({
                hour: hourData.hour,
                hourLabel: hourData.hourLabel,
                dataUrl: buildingFocusDataUrl,
                synthetic: false,
              });
            } else {
              // If no building boundaries, use the full image for building focus as well
              buildingFocusVisualizations.push({
                hour: hourData.hour,
                hourLabel: hourData.hourLabel,
                dataUrl: fullImageDataUrl,
                synthetic: false,
              });
            }

            console.log(
              `[HourlyShadeVisualizer] Completed visualizations for ${hourData.hourLabel}`
            );
          } catch (error) {
            console.error(
              `[HourlyShadeVisualizer] Error creating visualization for hour ${hourData.hour}: ${error.message}`
            );
            throw error;
          }
        }

        console.log(
          `[HourlyShadeVisualizer] Created ${hoursToProcess.length} visualizations in both formats`
        );

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
      // Log the error and re-throw it
      console.error(`[HourlyShadeVisualizer] Error: ${error.message}`);
      throw new Error(
        `Failed to visualize hourly shade data: ${error.message}`
      );
    }
  }

  // Helper method to create visualization for a single hour
  async createHourVisualization(
    shadeRaster,
    width,
    height,
    maskRaster,
    buildingBoundaries,
    palette,
    maxDimension,
    buildingFocus
  ) {
    // Determine dimensions and cropping
    let outputWidth, outputHeight, startX, startY;
    let croppedData;

    if (buildingFocus && buildingBoundaries?.hasBuilding) {
      // Use building boundaries for cropping
      console.log(
        "[HourlyShadeVisualizer] Using building focus for visualization"
      );

      const { minX, minY, width: bWidth, height: bHeight } = buildingBoundaries;
      startX = minX;
      startY = minY;
      outputWidth = bWidth;
      outputHeight = bHeight;

      // Create cropped data array
      croppedData = new Array(outputWidth * outputHeight);
      for (let y = 0; y < outputHeight; y++) {
        for (let x = 0; x < outputWidth; x++) {
          const srcIdx = (startY + y) * width + (startX + x);
          const destIdx = y * outputWidth + x;
          croppedData[destIdx] = shadeRaster[srcIdx];
        }
      }
    } else {
      // Use full image
      console.log("[HourlyShadeVisualizer] Using full image for visualization");
      startX = 0;
      startY = 0;
      outputWidth = width;
      outputHeight = height;
      croppedData = shadeRaster;
    }

    // Apply max dimension limit if needed
    if (outputWidth > maxDimension || outputHeight > maxDimension) {
      const aspectRatio = outputWidth / outputHeight;
      if (outputWidth > outputHeight) {
        outputWidth = maxDimension;
        outputHeight = Math.round(maxDimension / aspectRatio);
      } else {
        outputHeight = maxDimension;
        outputWidth = Math.round(maxDimension * aspectRatio);
      }
      console.log(
        `[HourlyShadeVisualizer] Resized to ${outputWidth}x${outputHeight} to fit max dimension`
      );
    }

    // Create a mask array for cropping if needed
    let croppedMaskRaster = null;
    if (maskRaster && buildingFocus && buildingBoundaries?.hasBuilding) {
      croppedMaskRaster = new Array(outputWidth * outputHeight);
      for (let y = 0; y < outputHeight; y++) {
        for (let x = 0; x < outputWidth; x++) {
          const srcIdx = (startY + y) * width + (startX + x);
          const destIdx = y * outputWidth + x;
          croppedMaskRaster[destIdx] = maskRaster[srcIdx];
        }
      }
    }

    // Create canvas and context
    const { canvas, ctx } = this.createEmptyCanvas(outputWidth, outputHeight);

    // Create image data
    const imageData = ctx.createImageData(outputWidth, outputHeight);

    // Fill the image data
    for (let y = 0; y < outputHeight; y++) {
      for (let x = 0; x < outputWidth; x++) {
        const idx = y * outputWidth + x;
        const destIdx = (y * outputWidth + x) * 4;

        // Get shade value (0 = shade, 1 = sun)
        const shadeValue = croppedData[idx];

        // Apply mask if available
        const useMask =
          maskRaster && buildingFocus && buildingBoundaries?.hasBuilding;
        const isMasked = useMask && croppedMaskRaster[idx] > 0;

        // Set color based on shade value
        const colorIndex = shadeValue ? palette.length - 1 : 0;
        const color = palette[colorIndex];

        imageData.data[destIdx] = color.r; // Red
        imageData.data[destIdx + 1] = color.g; // Green
        imageData.data[destIdx + 2] = color.b; // Blue

        // Set alpha (transparency)
        if (useMask) {
          imageData.data[destIdx + 3] = isMasked ? 255 : 0; // Transparent if not masked
        } else {
          imageData.data[destIdx + 3] = 255; // Fully opaque
        }
      }
    }

    // Put the image data on the canvas
    ctx.putImageData(imageData, 0, 0);

    // Convert canvas to data URL
    return this.canvasToDataURL(canvas, {
      mimeType: "image/png",
      quality: config.visualization.PNG_QUALITY,
    });
  }
}

module.exports = HourlyShadeVisualizer;
