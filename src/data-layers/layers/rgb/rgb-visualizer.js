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
        console.log(
          `[RgbVisualizer] Has building boundaries: ${!!buildingBoundaries?.hasBuilding}`
        );

        // Ensure we have 3 bands for RGB
        if (rasters.length !== 3) {
          throw new Error(
            `Expected 3 bands for RGB visualization, got ${rasters.length}`
          );
        }

        // IMPORTANT: The processor already crops the rasters to building boundaries
        // So rasters[0], rasters[1], rasters[2] are already the correct size
        // We just need to create visualizations from the provided data

        // Create building-focused visualization (this is the main/primary view)
        console.log(
          "[RgbVisualizer] Creating building-focused visualization from cropped data"
        );
        const buildingFocusDataUrl = await this.createRgbVisualization(
          rasters,
          width,
          height,
          maskRaster,
          buildingBoundaries
        );

        // For full image, we would need the original uncropped data
        // Since we only have cropped data, use the same visualization for both
        const fullImageDataUrl = buildingFocusDataUrl;

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
   * Create RGB visualization from already-processed (cropped) data
   * @private
   */
  async createRgbVisualization(
    rasters,
    width,
    height,
    maskRaster,
    buildingBoundaries
  ) {
    console.log(
      `[RgbVisualizer] Creating RGB visualization: ${width}x${height}`
    );

    // The rasters are already cropped to the building, so we use them directly
    const redRaster = rasters[0];
    const greenRaster = rasters[1];
    const blueRaster = rasters[2];

    // Create canvas with the provided dimensions
    const { canvas, ctx } = this.createEmptyCanvas(width, height);
    const imageData = ctx.createImageData(width, height);

    // Fill the image data with RGB values
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIdx = y * width + x;
        const destIdx = pixelIdx * 4;

        // Check if we should apply mask transparency
        const useMask = !!maskRaster;
        const isMasked = useMask ? maskRaster[pixelIdx] > 0 : true;

        // Set RGB values (ensure they're in 0-255 range)
        imageData.data[destIdx] = Math.max(
          0,
          Math.min(255, redRaster[pixelIdx] || 0)
        );
        imageData.data[destIdx + 1] = Math.max(
          0,
          Math.min(255, greenRaster[pixelIdx] || 0)
        );
        imageData.data[destIdx + 2] = Math.max(
          0,
          Math.min(255, blueRaster[pixelIdx] || 0)
        );

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
