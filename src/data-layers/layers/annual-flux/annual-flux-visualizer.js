/**
 * Annual flux layer visualizer for SolarScanner data-layers module
 */

const Visualizer = require("../../core/visualizer");
const ColorPalettes = require("../../utils/color-palettes");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

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
   * Create visualization from processed annual flux data
   * @param {Object} processedData - The processed annual flux data
   * @param {Object} options - Visualization options
   * @returns {Promise<Object>} - Object containing visualization data URLs
   */
  async visualize(processedData, options = {}) {
    try {
      return await this.timeOperation("visualize", async () => {
        console.log(
          "[AnnualFluxVisualizer] Creating visualization from annual flux data"
        );

        // Check if we should create synthetic visualization
        if (options.synthetic || !processedData) {
          console.log(
            "[AnnualFluxVisualizer] Creating synthetic visualization"
          );
          const syntheticUrl = this.createSyntheticVisualization(options);
          return {
            rawFlux: syntheticUrl,
            mask: syntheticUrl,
            maskedFlux: syntheticUrl,
          };
        }

        // Validate processed data
        this.validateProcessedData(processedData, [
          "fluxRaster",
          "metadata",
          "buildingBoundaries",
        ]);

        // Get data from processed result
        const {
          fluxRaster,
          originalFluxRaster,
          maskRaster,
          buildingBoundaries,
          metadata,
        } = processedData;

        // Get dimensions from metadata
        const width = metadata.dimensions.width;
        const height = metadata.dimensions.height;

        console.log(
          `[AnnualFluxVisualizer] Processing data with dimensions: ${width}x${height}`
        );

        // Set visualization options
        const buildingFocus = options.buildingFocus !== false;
        const maxDimension =
          options.maxDimension || config.visualization.MAX_DIMENSION || 400;

        // Determine the color palette
        const palette =
          options.palette ||
          ColorPalettes.getPalette(options.paletteName || "IRON");
        const maskPalette = ColorPalettes.getPalette("BINARY");

        console.log(
          `[AnnualFluxVisualizer] Using ${
            options.paletteName || "IRON"
          } palette for visualization`
        );

        // Create visualization results object
        const visualizationResults = {};

        // 1. Create raw flux visualization
        const rawFluxCanvas = VisualizationUtils.createCanvas(
          originalFluxRaster || fluxRaster,
          width,
          height,
          palette,
          {
            min: 0,
            max: 1800,
            useAlpha: false,
            noDataValue: config.processing.NO_DATA_VALUE,
          }
        );

        visualizationResults.rawFlux =
          VisualizationUtils.canvasToDataURL(rawFluxCanvas);
        console.log("[AnnualFluxVisualizer] Created raw flux visualization");

        // 2. Create mask visualization
        if (maskRaster) {
          const maskCanvas = VisualizationUtils.createCanvas(
            maskRaster,
            width,
            height,
            maskPalette,
            {
              min: 0,
              max: 1,
              useAlpha: false,
            }
          );

          visualizationResults.mask =
            VisualizationUtils.canvasToDataURL(maskCanvas);
          console.log("[AnnualFluxVisualizer] Created mask visualization");
        } else {
          visualizationResults.mask = null;
          console.log("[AnnualFluxVisualizer] No mask data available");
        }

        // 3. Create masked flux visualization
        // Determine dimensions and cropping for masked flux
        let outputWidth, outputHeight, startX, startY;
        let dataToVisualize;

        if (buildingFocus && buildingBoundaries?.hasBuilding) {
          // Use building boundaries for cropping
          console.log(
            "[AnnualFluxVisualizer] Using building focus for visualization"
          );

          // Extract boundaries
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

          // Crop the data
          const cropResult = VisualizationUtils.cropData(
            fluxRaster,
            width,
            height,
            {
              minX: startX,
              minY: startY,
              width: outputWidth,
              height: outputHeight,
            }
          );

          dataToVisualize = cropResult.data;
        } else {
          // Use full image
          console.log(
            "[AnnualFluxVisualizer] Using full image for visualization"
          );
          startX = 0;
          startY = 0;
          outputWidth = width;
          outputHeight = height;
          dataToVisualize = fluxRaster;
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
            `[AnnualFluxVisualizer] Resized to ${outputWidth}x${outputHeight} to fit max dimension`
          );
        }

        // Use fixed range or dynamically calculated range
        const min = 0; // Always start from 0
        const max = metadata.dataRange?.max || 1800;

        console.log(
          `[AnnualFluxVisualizer] Using data range: min=${min}, max=${max}`
        );

        // Create masked flux visualization
        const maskedFluxCanvas = VisualizationUtils.createCanvas(
          dataToVisualize,
          outputWidth,
          outputHeight,
          palette,
          {
            min,
            max,
            useAlpha: true,
            noDataValue: config.processing.NO_DATA_VALUE,
          }
        );

        visualizationResults.maskedFlux =
          VisualizationUtils.canvasToDataURL(maskedFluxCanvas);
        console.log("[AnnualFluxVisualizer] Created masked flux visualization");

        // Return all visualizations
        console.log(
          "[AnnualFluxVisualizer] Annual flux visualization complete"
        );
        return visualizationResults;
      });
    } catch (error) {
      console.error(
        `[AnnualFluxVisualizer] Visualization error: ${error.message}`
      );

      // Create synthetic visualization as fallback
      const syntheticUrl = this.createSyntheticVisualization({
        width: options.width || 400,
        height: options.height || 300,
        location: options.location,
      });

      return {
        rawFlux: syntheticUrl,
        mask: syntheticUrl,
        maskedFlux: syntheticUrl,
        error: error.message,
      };
    }
  }

  /**
   * Create a synthetic visualization for when real data is unavailable
   * @param {Object} options - Options for the synthetic visualization
   * @returns {string} - Data URL of the synthetic visualization
   */
  createSyntheticVisualization(options = {}) {
    const width = options.width || 400;
    const height = options.height || 300;
    const location = options.location || { latitude: 0, longitude: 0 };
    const palette =
      options.palette ||
      ColorPalettes.getPalette(options.paletteName || "IRON");

    return VisualizationUtils.createSyntheticVisualization(
      width,
      height,
      0, // month (not relevant for annual flux)
      location,
      palette
    );
  }
}

module.exports = AnnualFluxVisualizer;
