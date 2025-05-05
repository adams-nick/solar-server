/**
 * Main export file for SolarScanner data-layers module
 *
 * Provides factory function for creating LayerManager and exports
 * key utilities and constants.
 */

// Import core components
const DataLayerFactory = require("./core/data-layer-factory");
const LayerManager = require("./managers/layer-manager");

// Import fetchers
const MaskFetcher = require("./layers/mask/mask-fetcher");
const MonthlyFluxFetcher = require("./layers/monthly-flux/monthly-flux-fetcher");
const AnnualFluxFetcher = require("./layers/annual-flux/annual-flux-fetcher");
const RgbFetcher = require("./layers/rgb/rgb-fetcher"); // Add RGB fetcher
const HourlyShadeFetcher = require("./layers/hourly-shade/hourly-shade-fetcher");

// Import processors
const MaskProcessor = require("./layers/mask/mask-processor");
const MonthlyFluxProcessor = require("./layers/monthly-flux/monthly-flux-processor");
const AnnualFluxProcessor = require("./layers/annual-flux/annual-flux-processor");
const RgbProcessor = require("./layers/rgb/rgb-processor"); // Add RGB processor
const HourlyShadeProcessor = require("./layers/hourly-shade/hourly-shade-processor");

// Import visualizers
const MaskVisualizer = require("./layers/mask/mask-visualizer");
const MonthlyFluxVisualizer = require("./layers/monthly-flux/monthly-flux-visualizer");
const AnnualFluxVisualizer = require("./layers/annual-flux/annual-flux-visualizer");
const RgbVisualizer = require("./layers/rgb/rgb-visualizer"); // Add RGB visualizer
const HourlyShadeVisualizer = require("./layers/hourly-shade/hourly-shade-visualizer");

// Import utilities
const ColorPalettes = require("./utils/color-palettes");
const GeoTiffProcessor = require("./utils/geotiff-processor");
const VisualizationUtils = require("./utils/visualization-utils");

// Import configuration
const config = require("./config");

/**
 * Layer types enum
 */
const LAYER_TYPES = {
  MASK: "mask",
  DSM: "dsm",
  RGB: "rgb",
  ANNUAL_FLUX: "annualFlux",
  MONTHLY_FLUX: "monthlyFlux",
  HOURLY_SHADE: "hourlyShade",
};

/**
 * Create and configure a data layer manager
 * @param {Object} apiClient - API client for making requests
 * @param {Object} options - Configuration options
 * @returns {LayerManager} - Configured layer manager
 */
function createLayerManager(apiClient, options = {}) {
  if (!apiClient) {
    throw new Error("API client is required for createLayerManager");
  }

  console.log("[DataLayers] Creating layer manager");

  // Merge options with default config
  const mergedConfig = { ...config, ...options };

  // Create factory
  const factory = new DataLayerFactory();

  // Register fetchers
  factory.registerFetcher(new MaskFetcher(apiClient));
  factory.registerFetcher(new MonthlyFluxFetcher(apiClient));
  factory.registerFetcher(new AnnualFluxFetcher(apiClient));
  factory.registerFetcher(new RgbFetcher(apiClient)); // Register RGB fetcher
  factory.registerFetcher(new HourlyShadeFetcher(apiClient));

  // Register processors
  factory.registerProcessor(new MaskProcessor());
  factory.registerProcessor(new MonthlyFluxProcessor());
  factory.registerProcessor(new AnnualFluxProcessor());
  factory.registerProcessor(new RgbProcessor()); // Register RGB processor
  factory.registerProcessor(new HourlyShadeProcessor());

  // Register visualizers
  factory.registerVisualizer(new MaskVisualizer());
  factory.registerVisualizer(new MonthlyFluxVisualizer());
  factory.registerVisualizer(new AnnualFluxVisualizer());
  factory.registerVisualizer(new RgbVisualizer()); // Register RGB visualizer
  factory.registerVisualizer(new HourlyShadeVisualizer());

  // Create layer manager
  return new LayerManager(factory, apiClient);
}

// Export the functionality
module.exports = {
  // Main factory function
  createLayerManager,

  // Core classes for extension
  DataLayerFactory,
  LayerManager,

  // Base classes for extension
  Fetcher: require("./core/fetcher"),
  Processor: require("./core/processor"),
  Visualizer: require("./core/visualizer"),

  // Utilities
  ColorPalettes,
  GeoTiffProcessor,
  VisualizationUtils,

  // Constants
  LAYER_TYPES,
  config,
};
