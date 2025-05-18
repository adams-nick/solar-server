/**
 * DSM layer visualizer for SolarScanner data-layers module
 *
 * Creates visualizations from processed DSM (Digital Surface Model) data,
 * showing terrain and building elevation.
 */

const Visualizer = require("../../core/visualizer");
const ColorPalettes = require("../../utils/color-palettes");
const config = require("../../config");
const VisualizationUtils = require("../../utils/visualization-utils");

/**
 * Visualizer implementation for DSM layer data
 * @extends Visualizer
 */
class DsmVisualizer extends Visualizer {
  /**
   * Create a new DsmVisualizer
   */
  constructor() {
    super();
    console.log("[DsmVisualizer] Initialized");
  }

  /**
   * Check if this visualizer can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this visualizer can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "dsm";
  }

  /**
   * Create a visualization from processed DSM data
   * @param {Object} processedData - The processed DSM data
   * @param {Object} options - Visualization options
   * @param {boolean} [options.buildingFocus=true] - Whether to focus on building boundaries
   * @param {number} [options.maxDimension=400] - Maximum dimension for the output image
   * @param {Array<Object>} [options.palette] - Custom color palette to use
   * @param {string} [options.paletteName='RAINBOW'] - Name of predefined palette to use
   * @returns {Promise<string>} - Data URL of the visualization
   * @throws {Error} if visualization fails
   */
  async visualize(processedData, options = {}) {
    try {
      return await this.timeOperation("visualize", async () => {
        console.log("[DsmVisualizer] Creating visualization from DSM data");

        // Validate processed data
        this.validateProcessedData(processedData, ["raster", "metadata"]);

        // Get data and configuration
        const { raster, maskRaster, metadata } = processedData;
        const { width, height } = metadata.dimensions;
        const buildingFocus = options.buildingFocus !== false;

        // Get color palette (Rainbow palette like in Google demo)
        const palette =
          options.palette ||
          ColorPalettes.getPalette(options.paletteName || "RAINBOW");

        // Get data range from metadata (like in Google demo)
        const dataRange = metadata.dataRange || { min: 0, max: 100 };
        const min = dataRange.min;
        const max = dataRange.max;

        console.log(`[DsmVisualizer] Using data range: min=${min}, max=${max}`);

        // Use mask if building focus is enabled
        const useMask = buildingFocus && maskRaster ? maskRaster : undefined;

        // Create DSM visualization (similar to Google demo's renderPalette)
        const canvas = VisualizationUtils.createCanvas(
          raster,
          width,
          height,
          palette,
          {
            min,
            max,
            useAlpha: buildingFocus,
            noDataValue: config.processing.NO_DATA_VALUE,
          }
        );

        // Convert to data URL and return
        return VisualizationUtils.canvasToDataURL(canvas);
      });
    } catch (error) {
      return this.handleVisualizationError(
        error,
        "visualize",
        {
          layerType: "dsm",
          options,
        },
        { createFallback: true }
      );
    }
  }

  // Note: Border and legend methods are kept for future reference, but they are no longer called
  /**
   * Add a border around the entire image (not used)
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
   * @param {number} width - Canvas width
   * @param {number} height - Canvas height
   * @param {Object} options - Border options
   */
  addBorder(ctx, width, height, options = {}) {
    try {
      // Border properties
      const borderColor = options.borderColor || "rgba(0,0,0,0.8)";
      const borderWidth = options.borderWidth || 3;

      // Save current context state
      ctx.save();

      // Set border style
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderWidth;

      // Draw border around the entire canvas
      // Inset the border by half its width to make it visible on the edge
      const offset = borderWidth / 2;
      ctx.strokeRect(offset, offset, width - borderWidth, height - borderWidth);

      // Restore context state
      ctx.restore();

      console.log(
        `[DsmVisualizer] Added border: ${borderWidth}px ${borderColor}`
      );
    } catch (error) {
      console.error(`[DsmVisualizer] Error adding border: ${error.message}`);
      // Continue without border
    }
  }

  /**
   * Add a color legend to the canvas (not used)
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
   * @param {number} width - Canvas width
   * @param {number} height - Canvas height
   * @param {Array<Object>} palette - Color palette
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   */
  addColorLegend(ctx, width, height, palette, min, max) {
    try {
      // Legend dimensions
      const legendHeight = 20;
      const legendWidth = Math.min(width - 20, 200);
      const legendX = 10;
      const legendY = height - legendHeight - 10;

      // Draw gradient bar
      const gradient = ctx.createLinearGradient(
        legendX,
        0,
        legendX + legendWidth,
        0
      );

      // Add color stops from palette
      for (let i = 0; i < palette.length; i++) {
        const color = palette[i];
        const stop = i / (palette.length - 1);
        gradient.addColorStop(stop, `rgb(${color.r}, ${color.g}, ${color.b})`);
      }

      // Draw legend background
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.fillRect(
        legendX - 5,
        legendY - 5,
        legendWidth + 10,
        legendHeight + 25
      );

      // Draw gradient bar
      ctx.fillStyle = gradient;
      ctx.fillRect(legendX, legendY, legendWidth, legendHeight);

      // Draw border
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

      // Draw min and max values
      ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
      ctx.font = "12px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`${min.toFixed(1)} m`, legendX, legendY + legendHeight + 15);
      ctx.textAlign = "right";
      ctx.fillText(
        `${max.toFixed(1)} m`,
        legendX + legendWidth,
        legendY + legendHeight + 15
      );

      // Draw title
      ctx.textAlign = "center";
      ctx.fillText("Elevation", legendX + legendWidth / 2, legendY - 5);
    } catch (error) {
      console.error(
        `[DsmVisualizer] Error adding color legend: ${error.message}`
      );
      // Continue without legend
    }
  }
}

module.exports = DsmVisualizer;
