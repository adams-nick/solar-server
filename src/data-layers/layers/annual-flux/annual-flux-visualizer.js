/**
 * Annual flux layer visualizer for SolarScanner data-layers module
 *
 * Creates a visualization from processed annual flux data, showing yearly
 * solar potential with appropriate color mapping.
 */

const Visualizer = require("../../core/visualizer");
const ColorPalettes = require("../../utils/color-palettes");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

/**
 * Visualizer implementation for annual flux layer data
 * @extends Visualizer
 */
class AnnualFluxVisualizer extends Visualizer {
  /**
   * Create a new AnnualFluxVisualizer
   */
  constructor() {
    super();
    console.log("[AnnualFluxVisualizer] Initialized");
  }

  /**
   * Check if this visualizer can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this visualizer can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "annualFlux";
  }

  /**
   * Create a visualization from processed annual flux data
   * @param {Object} processedData - The processed annual flux data
   * @param {Object} options - Visualization options
   * @param {boolean} [options.buildingFocus=true] - Whether to focus on building boundaries
   * @param {number} [options.maxDimension=400] - Maximum dimension for the output image
   * @param {Array<Object>} [options.palette] - Custom color palette to use
   * @param {string} [options.paletteName='IRON'] - Name of predefined palette to use
   * @param {boolean} [options.synthetic=false] - Whether to create synthetic visualization
   * @returns {Promise<string>} - Data URL of the visualization
   * @throws {Error} if visualization fails
   */
  async visualize(processedData, options = {}) {
    try {
      return await this.timeOperation("visualize", async () => {
        console.log(
          "[AnnualFluxVisualizer] Creating visualization from annual flux data"
        );

        // Check if we should create synthetic visualization
        if (options.synthetic || !processedData || options.forceSynthetic) {
          console.log(
            "[AnnualFluxVisualizer] Creating synthetic visualization"
          );
          return this.createSyntheticVisualization(options);
        }

        // Validate processed data
        this.validateProcessedData(processedData, [
          "fluxRaster",
          "metadata",
          "maskRaster",
        ]);

        // Get data from processed result
        const { fluxRaster, metadata, buildingBoundaries, maskRaster } =
          processedData;
        const width = metadata.dimensions.width;
        const height = metadata.dimensions.height;

        // Set visualization options
        const buildingFocus = options.buildingFocus !== false;
        const maxDimension =
          options.maxDimension || config.visualization.MAX_DIMENSION;

        // Determine the color palette
        let palette;
        if (options.palette) {
          palette = options.palette;
        } else {
          const paletteName = options.paletteName || "IRON";
          palette = ColorPalettes.getPalette(paletteName);
        }

        // Determine dimensions and cropping
        let outputWidth, outputHeight, startX, startY;
        let croppedFlux, croppedMask;

        if (buildingFocus && buildingBoundaries?.hasBuilding) {
          // Use building boundaries for cropping
          console.log(
            "[AnnualFluxVisualizer] Using building focus for visualization"
          );

          const {
            minX,
            minY,
            width: bWidth,
            height: bHeight,
          } = buildingBoundaries;
          startX = minX;
          startY = minY;
          outputWidth = bWidth;
          outputHeight = bHeight;

          // Create cropped data arrays
          croppedFlux = new Array(outputWidth * outputHeight);
          croppedMask = maskRaster
            ? new Array(outputWidth * outputHeight)
            : null;

          for (let y = 0; y < outputHeight; y++) {
            for (let x = 0; x < outputWidth; x++) {
              const srcIdx = (startY + y) * width + (startX + x);
              const destIdx = y * outputWidth + x;
              croppedFlux[destIdx] = fluxRaster[srcIdx];
              if (croppedMask) {
                croppedMask[destIdx] = maskRaster[srcIdx];
              }
            }
          }
        } else {
          // Use full image
          console.log(
            "[AnnualFluxVisualizer] Using full image for visualization"
          );
          startX = 0;
          startY = 0;
          outputWidth = width;
          outputHeight = height;
          croppedFlux = fluxRaster;
          croppedMask = maskRaster;
        }

        // Apply max dimension limit if needed
        const { width: finalWidth, height: finalHeight } =
          VisualizationUtils.resizeDimensions(outputWidth, outputHeight, {
            maxDimension,
          });

        outputWidth = finalWidth;
        outputHeight = finalHeight;

        console.log(
          `[AnnualFluxVisualizer] Resized to ${outputWidth}x${outputHeight} to fit max dimension`
        );

        // Get data range for normalization
        let min = metadata.statistics?.min || 0;
        let max = metadata.statistics?.max || 2000; // Default higher max for annual data

        // Apply mask to flux data
        let maskedFlux;
        if (croppedMask) {
          maskedFlux = this.applyMask(
            croppedFlux,
            croppedMask,
            outputWidth,
            outputHeight
          );
        } else {
          maskedFlux = croppedFlux;
        }

        // Create empty canvas
        const { canvas, ctx } = this.createEmptyCanvas(
          outputWidth,
          outputHeight,
          {
            transparent: true,
          }
        );

        // Create image data
        const imageData = ctx.createImageData(outputWidth, outputHeight);

        // Calculate pixel scaling if dimensions changed
        const scaleX = croppedFlux.length / outputWidth / outputHeight;

        // Fill the image data
        const noDataValue = config.processing.NO_DATA_VALUE;

        for (let y = 0; y < outputHeight; y++) {
          for (let x = 0; x < outputWidth; x++) {
            // Get the source index with appropriate scaling
            const srcIdx =
              Math.floor(y * outputWidth * scaleX) + Math.floor(x * scaleX);
            const destIdx = (y * outputWidth + x) * 4;

            const value = maskedFlux[srcIdx];

            if (value === noDataValue || value === undefined || isNaN(value)) {
              // Transparent for no data
              imageData.data[destIdx + 3] = 0;
            } else {
              // Normalize value to palette index
              const normalizedValue = Math.max(
                0,
                Math.min(1, (value - min) / (max - min))
              );
              const colorIndex = Math.floor(
                normalizedValue * (palette.length - 1)
              );
              const color = palette[colorIndex];

              // Set RGB values
              imageData.data[destIdx] = color.r;
              imageData.data[destIdx + 1] = color.g;
              imageData.data[destIdx + 2] = color.b;
              imageData.data[destIdx + 3] = 255; // Fully opaque
            }
          }
        }

        // Put image data on canvas
        ctx.putImageData(imageData, 0, 0);

        // Add legend
        this.addLegend(ctx, outputWidth, outputHeight, min, max, palette);

        // Convert to data URL
        const dataUrl = this.canvasToDataURL(canvas, {
          mimeType: "image/png",
          quality: options.quality || config.visualization.PNG_QUALITY,
        });

        console.log(
          "[AnnualFluxVisualizer] Annual flux visualization complete"
        );

        return dataUrl;
      });
    } catch (error) {
      // Handle visualization error with fallback
      return this.handleVisualizationError(
        error,
        "visualize",
        {
          layerType: "annualFlux",
          options,
          width: processedData?.metadata?.dimensions?.width || 400,
          height: processedData?.metadata?.dimensions?.height || 300,
        },
        { createFallback: true }
      );
    }
  }

  /**
   * Apply mask to flux data
   * @private
   * @param {Array<number>} fluxRaster - Flux raster data
   * @param {Array<number>} maskRaster - Mask raster data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {Array<number>} - Masked flux data
   */
  applyMask(fluxRaster, maskRaster, width, height) {
    try {
      const maskedRaster = new Array(fluxRaster.length);
      const noDataValue = config.processing.NO_DATA_VALUE;

      for (let i = 0; i < fluxRaster.length; i++) {
        // If mask is 0 or undefined, set flux to no data value
        maskedRaster[i] = maskRaster[i] > 0 ? fluxRaster[i] : noDataValue;
      }

      return maskedRaster;
    } catch (error) {
      console.error(
        `[AnnualFluxVisualizer] Error applying mask: ${error.message}`
      );
      return fluxRaster; // Return original raster if masking fails
    }
  }

  /**
   * Create a synthetic visualization when real data is unavailable
   * @private
   * @param {Object} options - Options for synthetic visualization
   * @param {Object} [options.location] - Location coordinates
   * @param {number} [options.width=400] - Width of visualization
   * @param {number} [options.height=300] - Height of visualization
   * @returns {string} - Data URL of synthetic visualization
   */
  createSyntheticVisualization(options = {}) {
    try {
      console.log("[AnnualFluxVisualizer] Creating synthetic visualization");

      const width = options.width || 400;
      const height = options.height || 300;
      const location = options.location || { latitude: 0, longitude: 0 };

      // Get color palette
      const palette = ColorPalettes.getPalette("IRON");

      // Create a synthetic visualization
      return VisualizationUtils.createSyntheticVisualization(
        width,
        height,
        5, // Middle of the year (representing annual average)
        location,
        palette
      );
    } catch (error) {
      console.error(
        `[AnnualFluxVisualizer] Error creating synthetic visualization: ${error.message}`
      );

      // Create simple fallback
      return this.createFallbackVisualization(
        {
          width: options.width || 400,
          height: options.height || 300,
          layerType: "annualFlux",
        },
        "Failed to create synthetic visualization"
      );
    }
  }

  /**
   * Add a scale legend to the visualization
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} width - Canvas width
   * @param {number} height - Canvas height
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @param {Array<Object>} palette - Color palette
   */
  addLegend(ctx, width, height, min, max, palette) {
    try {
      const legendHeight = 30;
      const legendWidth = Math.min(width * 0.8, 200);
      const legendX = (width - legendWidth) / 2;
      const legendY = height - legendHeight - 10;

      // Draw legend gradient
      const gradient = ctx.createLinearGradient(
        legendX,
        0,
        legendX + legendWidth,
        0
      );

      // Add color stops based on palette
      for (let i = 0; i < palette.length; i++) {
        const position = i / (palette.length - 1);
        const color = palette[i];
        gradient.addColorStop(
          position,
          `rgb(${color.r}, ${color.g}, ${color.b})`
        );
      }

      // Draw legend bar
      ctx.fillStyle = gradient;
      ctx.fillRect(legendX, legendY, legendWidth, 10);

      // Draw border around legend
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(legendX, legendY, legendWidth, 10);

      // Add labels
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.font = "10px Arial";
      ctx.textAlign = "center";

      // Min label
      ctx.fillText(Math.round(min).toString(), legendX, legendY + 25);

      // Max label
      ctx.fillText(
        Math.round(max).toString(),
        legendX + legendWidth,
        legendY + 25
      );

      // Middle label
      ctx.fillText(
        Math.round((min + max) / 2).toString(),
        legendX + legendWidth / 2,
        legendY + 25
      );

      // Unit label
      ctx.fillText("kWh/kW/year", legendX + legendWidth / 2, legendY - 5);
    } catch (error) {
      console.error(
        `[AnnualFluxVisualizer] Error adding legend: ${error.message}`
      );
      // Continue without legend if it fails
    }
  }
}

module.exports = AnnualFluxVisualizer;
