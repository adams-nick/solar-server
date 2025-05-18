/**
 * RGB layer visualizer for SolarScanner data-layers module
 *
 * Creates visualizations from processed RGB data, showing aerial imagery.
 */

const Visualizer = require("../../core/visualizer");
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
   * @returns {Promise<Object>} - Object with data URLs for full image and building focus views
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

        // Get dimensions from metadata
        const width = metadata.dimensions?.width || metadata.width;
        const height = metadata.dimensions?.height || metadata.height;

        console.log(`[RgbVisualizer] Image dimensions: ${width}x${height}`);

        // Ensure we have 3 bands for RGB
        if (rasters.length !== 3) {
          throw new Error(
            `Expected 3 bands for RGB visualization, got ${rasters.length}`
          );
        }

        // Create full image visualization
        console.log("[RgbVisualizer] Creating full image visualization");
        const fullImageDataUrl = await this.createRgbVisualization(
          rasters,
          width,
          height,
          maskRaster,
          null // No building boundaries for full image
        );

        // Create building-focused visualization if building boundaries exist
        let buildingFocusDataUrl = fullImageDataUrl; // Default to full image
        if (buildingBoundaries?.hasBuilding) {
          console.log(
            "[RgbVisualizer] Creating building-focused visualization"
          );
          buildingFocusDataUrl = await this.createRgbVisualization(
            rasters,
            width,
            height,
            maskRaster,
            buildingBoundaries
          );
        }

        console.log("[RgbVisualizer] RGB visualization complete");
        return {
          buildingFocus: buildingFocusDataUrl,
          fullImage: fullImageDataUrl,
        };
      });
    } catch (error) {
      console.error(
        `[RgbVisualizer] Error creating visualization: ${error.message}`
      );
      throw new Error(`Failed to visualize RGB data: ${error.message}`);
    }
  }

  /**
   * Create RGB visualization with specified settings
   * @private
   */
  async createRgbVisualization(
    rasters,
    width,
    height,
    maskRaster,
    buildingBoundaries
  ) {
    // Determine if we're doing building-focused visualization
    const buildingFocus = !!buildingBoundaries?.hasBuilding;

    // Determine dimensions and source data
    let outputWidth, outputHeight, startX, startY;
    let redRaster, greenRaster, blueRaster;

    if (buildingFocus) {
      // Use building boundaries for cropping
      const { minX, minY, width: bWidth, height: bHeight } = buildingBoundaries;

      startX = minX;
      startY = minY;
      outputWidth = bWidth;
      outputHeight = bHeight;

      console.log(
        `[RgbVisualizer] Building size: ${outputWidth}x${outputHeight}`
      );

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
      startX = 0;
      startY = 0;
      outputWidth = width;
      outputHeight = height;

      redRaster = rasters[0];
      greenRaster = rasters[1];
      blueRaster = rasters[2];
    }

    // Create mask array for cropping if needed
    let croppedMaskRaster = null;
    if (maskRaster && buildingFocus) {
      croppedMaskRaster = new Array(outputWidth * outputHeight);
      for (let y = 0; y < outputHeight; y++) {
        for (let x = 0; x < outputWidth; x++) {
          const srcIdx = (startY + y) * width + (startX + x);
          const destIdx = y * outputWidth + x;
          croppedMaskRaster[destIdx] = maskRaster[srcIdx];
        }
      }
    }

    // Create canvas with exact output dimensions
    const { canvas, ctx } = this.createEmptyCanvas(outputWidth, outputHeight);
    const imageData = ctx.createImageData(outputWidth, outputHeight);

    // Fill the image data with RGB values
    for (let y = 0; y < outputHeight; y++) {
      for (let x = 0; x < outputWidth; x++) {
        const srcIdx = y * outputWidth + x;
        const destIdx = (y * outputWidth + x) * 4;

        // Apply mask if available
        const useMask = buildingFocus && croppedMaskRaster;
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
    return this.canvasToDataURL(canvas);
  }
}

module.exports = RgbVisualizer;
