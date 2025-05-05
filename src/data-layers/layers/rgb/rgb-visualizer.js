/**
 * RGB layer visualizer for SolarScanner data-layers module
 *
 * Creates visualizations from processed RGB data, showing aerial imagery.
 */

const Visualizer = require("../../core/visualizer");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

/**
 * Visualizer implementation for RGB layer data
 * @extends Visualizer
 */
class RgbVisualizer extends Visualizer {
  /**
   * Create a new RgbVisualizer
   */
  constructor() {
    super();
    console.log("[RgbVisualizer] Initialized");
  }

  /**
   * Check if this visualizer can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this visualizer can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "rgb";
  }

  /**
   * Create a visualization from processed RGB data
   * @param {Object} processedData - The processed RGB data
   * @param {Object} options - Visualization options
   * @returns {Promise<string>} - Data URL of the visualization
   */
  async visualize(processedData, options = {}) {
    try {
      return await this.timeOperation("visualize", async () => {
        console.log("[RgbVisualizer] Creating visualization from RGB data");

        // Validate processed data
        this.validateProcessedData(processedData, ["rasters", "metadata"]);

        // Get data from processed result
        const { rasters, metadata, buildingBoundaries, maskRaster } =
          processedData;
        const { width, height } = metadata.dimensions || metadata;

        // Ensure we have 3 bands for RGB
        if (rasters.length !== 3) {
          throw new Error(
            `Expected 3 bands for RGB visualization, got ${rasters.length}`
          );
        }

        // Set visualization options
        const buildingFocus = options.buildingFocus !== false;
        const maxDimension =
          options.maxDimension || config.visualization.MAX_DIMENSION;

        // Determine dimensions and cropping
        let outputWidth, outputHeight, startX, startY;
        let redRaster, greenRaster, blueRaster;

        if (buildingFocus && buildingBoundaries?.hasBuilding) {
          // Use building boundaries for cropping
          console.log("[RgbVisualizer] Using building focus for visualization");

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

          // Create cropped rasters for each channel
          redRaster = new Array(outputWidth * outputHeight);
          greenRaster = new Array(outputWidth * outputHeight);
          blueRaster = new Array(outputWidth * outputHeight);

          for (let y = 0; y < outputHeight; y++) {
            for (let x = 0; x < outputWidth; x++) {
              const srcIdx = (startY + y) * width + (startX + x);
              const destIdx = y * outputWidth + x;

              redRaster[destIdx] = rasters[0][srcIdx];
              greenRaster[destIdx] = rasters[1][srcIdx];
              blueRaster[destIdx] = rasters[2][srcIdx];
            }
          }
        } else {
          // Use full image
          console.log("[RgbVisualizer] Using full image for visualization");
          startX = 0;
          startY = 0;
          outputWidth = width;
          outputHeight = height;

          redRaster = rasters[0];
          greenRaster = rasters[1];
          blueRaster = rasters[2];
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
          console.log(
            `[RgbVisualizer] Resized to ${scaledWidth}x${scaledHeight} to fit max dimension`
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

        // Create canvas and context for the view
        const { canvas, ctx } = this.createEmptyCanvas(
          scaledWidth,
          scaledHeight
        );

        // Create image data
        const imageData = ctx.createImageData(scaledWidth, scaledHeight);

        // Fill the image data with RGB values (with optional scaling)
        for (let y = 0; y < scaledHeight; y++) {
          for (let x = 0; x < scaledWidth; x++) {
            // Calculate source coordinates (if scaling)
            const srcX = Math.floor(x * (outputWidth / scaledWidth));
            const srcY = Math.floor(y * (outputHeight / scaledHeight));
            const srcIdx = srcY * outputWidth + srcX;

            const destIdx = (y * scaledWidth + x) * 4;

            // Apply mask if available
            const useMask = options.useMask !== false && croppedMaskRaster;
            const isMasked = useMask && croppedMaskRaster[srcIdx] > 0;

            // Set RGB values
            imageData.data[destIdx] = redRaster[srcIdx]; // Red
            imageData.data[destIdx + 1] = greenRaster[srcIdx]; // Green
            imageData.data[destIdx + 2] = blueRaster[srcIdx]; // Blue

            // Set alpha (transparency)
            if (useMask) {
              imageData.data[destIdx + 3] = isMasked ? 255 : 0; // Use mask for transparency
            } else {
              imageData.data[destIdx + 3] = 255; // Fully opaque
            }
          }
        }

        // Put the image data on the canvas
        ctx.putImageData(imageData, 0, 0);

        // Return the data URL
        const dataUrl = this.canvasToDataURL(canvas);

        console.log("[RgbVisualizer] RGB visualization complete");
        return dataUrl;
      });
    } catch (error) {
      // Log the error and re-throw it to be handled by the layer manager
      console.error(
        `[RgbVisualizer] Error creating visualization: ${error.message}`
      );
      throw new Error(`Failed to visualize RGB data: ${error.message}`);
    }
  }
}

module.exports = RgbVisualizer;
