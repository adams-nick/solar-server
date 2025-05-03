/**
 * Monthly flux layer visualizer for SolarScanner data-layers module
 *
 * Creates visualizations from processed monthly flux data, showing solar
 * potential for each month with seasonal adjustments.
 */

const Visualizer = require("../../core/visualizer");
const ColorPalettes = require("../../utils/color-palettes");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

/**
 * Visualizer implementation for monthly flux layer data
 * @extends Visualizer
 */
class MonthlyFluxVisualizer extends Visualizer {
  /**
   * Create a new MonthlyFluxVisualizer
   */
  constructor() {
    super();
    console.log("[MonthlyFluxVisualizer] Initialized");
  }

  /**
   * Check if this visualizer can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this visualizer can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "monthlyFlux";
  }

  /**
   * Create visualizations from processed monthly flux data
   * @param {Object} processedData - The processed monthly flux data
   * @param {Object} options - Visualization options
   * @param {boolean} [options.buildingFocus=true] - Whether to focus on building boundaries
   * @param {number} [options.maxDimension=400] - Maximum dimension for the output image
   * @param {Array<Object>} [options.palette] - Custom color palette to use
   * @param {string} [options.paletteName='IRON'] - Name of predefined palette to use
   * @param {boolean} [options.applySeasonalAdjustment=true] - Whether to apply seasonal adjustment
   * @param {number} [options.month] - Specific month to visualize (0-11), null for all months
   * @param {boolean} [options.synthetic=false] - Whether to create synthetic visualization
   * @returns {Promise<Array<string>|string>} - Array of data URLs for all months or single URL
   * @throws {Error} if visualization fails
   */
  async visualize(processedData, options = {}) {
    try {
      return await this.timeOperation("visualize", async () => {
        console.log(
          "[MonthlyFluxVisualizer] Creating visualization(s) from monthly flux data"
        );

        // Check if we should create synthetic visualization
        if (options.synthetic || !processedData || options.forceSynthetic) {
          console.log(
            "[MonthlyFluxVisualizer] Creating synthetic visualization"
          );
          return this.createSyntheticVisualizations(options);
        }

        // Validate processed data
        this.validateProcessedData(processedData, ["metadata", "monthlyData"]);

        // Get data from processed result
        const { metadata, monthlyData, buildingBoundaries, maskRaster } =
          processedData;
        const { width, height } = metadata.dimensions;

        // Set visualization options
        const buildingFocus = options.buildingFocus !== false;
        const maxDimension =
          options.maxDimension || config.visualization.MAX_DIMENSION;
        const applySeasonalAdjustment =
          options.applySeasonalAdjustment !== false;

        // Determine if we're visualizing a specific month or all months
        const specificMonth = options.month !== undefined;
        const monthIndex = specificMonth ? options.month : null;

        // Determine the color palette
        let palette;
        if (options.palette) {
          palette = options.palette;
        } else {
          const paletteName = options.paletteName || "IRON";
          palette = ColorPalettes.getPalette(paletteName);
        }

        // Prepare result array
        const visualizations = [];

        // Filter months to process
        const monthsToProcess = specificMonth
          ? [monthlyData.find((m) => m.month === monthIndex) || monthlyData[0]]
          : monthlyData;

        // Process each month
        for (const monthData of monthsToProcess) {
          try {
            console.log(
              `[MonthlyFluxVisualizer] Processing visualization for ${monthData.monthName}`
            );

            // Get the raster data for this month
            const fluxRaster = monthData.raster;

            // Determine dimensions and cropping
            let outputWidth, outputHeight, startX, startY;
            let croppedData;

            if (buildingFocus && buildingBoundaries?.hasBuilding) {
              // Use building boundaries for cropping
              console.log(
                "[MonthlyFluxVisualizer] Using building focus for visualization"
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

              // Create cropped data array
              croppedData = new Array(outputWidth * outputHeight);
              for (let y = 0; y < outputHeight; y++) {
                for (let x = 0; x < outputWidth; x++) {
                  const srcIdx = (startY + y) * width + (startX + x);
                  const destIdx = y * outputWidth + x;
                  croppedData[destIdx] = fluxRaster[srcIdx];
                }
              }
            } else {
              // Use full image
              console.log(
                "[MonthlyFluxVisualizer] Using full image for visualization"
              );
              startX = 0;
              startY = 0;
              outputWidth = width;
              outputHeight = height;
              croppedData = fluxRaster;
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
                `[MonthlyFluxVisualizer] Resized to ${outputWidth}x${outputHeight} to fit max dimension`
              );
            }

            // Get data range for normalization
            let min = monthData.dataRange?.min || 0;
            let max = monthData.dataRange?.max || 200; // Default is typical for kWh/kW/month

            // Apply seasonal adjustment if requested
            let seasonalFactor = 1;
            if (applySeasonalAdjustment) {
              seasonalFactor =
                monthData.seasonalFactor ||
                VisualizationUtils.getSeasonalFactor(monthData.month);

              console.log(
                `[MonthlyFluxVisualizer] Applied seasonal factor ${seasonalFactor.toFixed(
                  2
                )} for ${monthData.monthName}`
              );
            }

            // Create canvas for this month
            const canvas = VisualizationUtils.createCanvas(
              croppedData,
              outputWidth,
              outputHeight,
              palette,
              {
                min,
                max,
                // Apply seasonal factor to each value by providing a transform function
                valueTransform: applySeasonalAdjustment
                  ? (val) => val * seasonalFactor
                  : undefined,
                // Use alpha for non-building areas
                useAlpha: true,
              }
            );

            // Convert to data URL
            const dataUrl = VisualizationUtils.canvasToDataURL(canvas, {
              mimeType: "image/png",
              quality: options.quality || config.visualization.PNG_QUALITY,
            });

            // Add metadata to the visualization
            visualizations.push({
              month: monthData.month,
              monthName: monthData.monthName,
              dataUrl,
              seasonal: applySeasonalAdjustment,
              seasonalFactor,
              synthetic: false,
            });

            console.log(
              `[MonthlyFluxVisualizer] Completed visualization for ${monthData.monthName}`
            );
          } catch (error) {
            console.error(
              `[MonthlyFluxVisualizer] Error creating visualization for month ${monthData.month}: ${error.message}`
            );

            // Add synthetic visualization as fallback
            const syntheticDataUrl = this.createSingleSyntheticVisualization(
              400,
              300,
              monthData.month,
              options.location
            );

            visualizations.push({
              month: monthData.month,
              monthName: monthData.monthName,
              dataUrl: syntheticDataUrl,
              seasonal: applySeasonalAdjustment,
              seasonalFactor:
                monthData.seasonalFactor ||
                VisualizationUtils.getSeasonalFactor(monthData.month),
              synthetic: true,
              error: error.message,
            });
          }
        }

        console.log(
          `[MonthlyFluxVisualizer] Created ${visualizations.length} visualizations`
        );

        // Return result based on request type
        if (specificMonth) {
          return visualizations[0].dataUrl;
        } else {
          return visualizations.map((v) => v.dataUrl);
        }
      });
    } catch (error) {
      // Handle visualization error with fallback
      const fallbackOptions = {
        location: options.location,
        month: options.month,
        specificMonth: options.month !== undefined,
      };

      return this.handleVisualizationError(
        error,
        "visualize",
        {
          layerType: "monthlyFlux",
          options,
          width: processedData?.metadata?.dimensions?.width || 400,
          height: processedData?.metadata?.dimensions?.height || 300,
        },
        { createFallback: true, fallbackOptions }
      );
    }
  }

  /**
   * Create synthetic visualizations for all months
   * @private
   * @param {Object} options - Options for synthetic visualization
   * @param {Object} [options.location] - Location coordinates
   * @param {number} [options.width=400] - Width of visualization
   * @param {number} [options.height=300] - Height of visualization
   * @param {number} [options.month] - Specific month to create, null for all months
   * @returns {Array<string>|string} - Array of data URLs or single URL
   */
  createSyntheticVisualizations(options = {}) {
    try {
      console.log("[MonthlyFluxVisualizer] Creating synthetic visualizations");

      const width = options.width || 400;
      const height = options.height || 300;
      const location = options.location || { latitude: 0, longitude: 0 };
      const specificMonth = options.month !== undefined;

      // Get color palette
      const palette = ColorPalettes.getPalette("IRON");

      if (specificMonth) {
        // Create single month visualization
        const month = options.month;
        const dataUrl = VisualizationUtils.createSyntheticVisualization(
          width,
          height,
          month,
          location,
          palette
        );

        return dataUrl;
      } else {
        // Create all month visualizations
        const visualizations = [];

        for (let month = 0; month < 12; month++) {
          const dataUrl = VisualizationUtils.createSyntheticVisualization(
            width,
            height,
            month,
            location,
            palette
          );

          visualizations.push(dataUrl);
        }

        return visualizations;
      }
    } catch (error) {
      console.error(
        `[MonthlyFluxVisualizer] Error creating synthetic visualizations: ${error.message}`
      );

      // Create simple fallback
      const fallbackUrl = this.createFallbackVisualization(
        {
          width: options.width || 400,
          height: options.height || 300,
          month: options.month,
          layerType: "monthlyFlux",
        },
        "Failed to create synthetic visualization"
      );

      return options.month !== undefined ? fallbackUrl : [fallbackUrl];
    }
  }

  /**
   * Create a single synthetic visualization for a specific month
   * @private
   * @param {number} width - Width of visualization
   * @param {number} height - Height of visualization
   * @param {number} month - Month index (0-11)
   * @param {Object} location - Location coordinates
   * @returns {string} - Data URL of synthetic visualization
   */
  createSingleSyntheticVisualization(width, height, month, location) {
    try {
      const palette = ColorPalettes.getPalette("IRON");
      return VisualizationUtils.createSyntheticVisualization(
        width,
        height,
        month,
        location,
        palette
      );
    } catch (error) {
      console.error(
        `[MonthlyFluxVisualizer] Error creating single synthetic visualization: ${error.message}`
      );

      // Create simple fallback
      return this.createFallbackVisualization(
        {
          width,
          height,
          month,
          layerType: "monthlyFlux",
        },
        "Failed to create synthetic visualization"
      );
    }
  }
}

module.exports = MonthlyFluxVisualizer;
