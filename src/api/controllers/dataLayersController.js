// src/api/controllers/dataLayersController.js
const axios = require("axios");
const path = require("path");
const dataLayers = require("../../data-layers");

// Load environment variables
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Create API client for the data layer manager
const apiClient = {
  apiKey: GOOGLE_MAPS_API_KEY,
  async get(url, options = {}) {
    return axios.get(url, options);
  },
};

// Create layer manager with custom options
const layerManager = dataLayers.createLayerManager(apiClient, {
  cache: {
    USE_CACHE: true,
    CACHE_DIR: path.join(__dirname, "../../cache"), // Note: Fixed the path to point to project root cache
  },
});

/**
 * Controller method to process data layer requests
 */
exports.processDataLayer = async (req, res) => {
  try {
    const { location, radius = 50, layerType = "monthlyFlux" } = req.body;

    if (!location || !location.latitude || !location.longitude) {
      return res.status(400).json({ error: "Invalid location data" });
    }

    console.log(
      `Processing data layer '${layerType}' for location: ${location.latitude}, ${location.longitude}`
    );

    try {
      const result = await layerManager.processLayer(layerType, location, {
        radius,
        buildingFocus: true,
        fallbackToSynthetic: false, // Return errors instead of synthetic data
      });

      // Create response object with common properties
      const response = {
        imageryQuality:
          result.processedData?.metadata?.imageryQuality || "MEDIUM",
        synthetic: result.synthetic || false,
        metadata: result.metadata,
        layerType: layerType,
      };

      // Format layer-specific response properties
      switch (layerType) {
        case "annualFlux":
          // For annual flux, provide a single dataUrl
          response.dataUrl = result.visualization;

          // If statistics are available, include them
          if (result.processedData?.metadata?.statistics) {
            response.statistics = result.processedData.metadata.statistics;
          }
          break;

        case "monthlyFlux":
          // For monthly flux, provide an array of URLs (one per month)
          response.monthlyDataUrls = Array.isArray(result.visualization)
            ? result.visualization
            : [result.visualization];
          break;

        case "mask":
          // For mask data, provide a single dataUrl for the mask
          response.dataUrl = result.visualization;

          // If building boundaries are available, include them
          if (result.processedData?.buildingBoundaries) {
            response.buildingBoundaries =
              result.processedData.buildingBoundaries;
          }
          break;

        default:
          // Generic handler for other layer types
          // Determine if the visualization is an array or single value
          if (Array.isArray(result.visualization)) {
            response.dataUrls = result.visualization;
          } else {
            response.dataUrl = result.visualization;
          }
          break;
      }

      // Return the formatted response
      return res.json(response);
    } catch (error) {
      // Check if this is a "no data available" error
      if (
        error.message &&
        (error.message.includes("empty data") ||
          error.message.includes("no data available") ||
          error.message.includes("Received empty data"))
      ) {
        // This is a "no data" error - return a 404 with useful message
        return res.status(404).json({
          error: "No solar data available for this location",
          details: error.message,
          location,
          layerType,
        });
      }

      // Other errors are returned as 500
      throw error;
    }
  } catch (error) {
    console.error(
      `Data layers error for ${req.body.layerType || "unknown layer"}:`,
      error
    );

    // Return error response
    res.status(500).json({
      error: error.message || "Failed to fetch solar data",
      layerType: req.body.layerType || "unknown",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

/**
 * Simple test endpoint controller
 */
exports.testEndpoint = (req, res) => {
  console.log("GET request received for data-layers test endpoint");
  res.send("Data layers API is working");
};

/**
 * Gets available layer types from the data layer manager
 */
exports.getAvailableLayerTypes = (req, res) => {
  try {
    // Get the factory from the layer manager
    const factory = layerManager.factory;

    // Get fully implemented layer types
    const availableTypes = factory.getFullyImplementedLayerTypes();

    return res.json({
      availableLayerTypes: availableTypes,
      supportedLayerTypes: factory.getSupportedLayerTypes(),
    });
  } catch (error) {
    console.error("Error getting available layer types:", error);
    return res.status(500).json({
      error: "Failed to get available layer types",
      details: error.message,
    });
  }
};
