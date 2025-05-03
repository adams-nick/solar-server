// In solarApiRoutes.js

const express = require("express");
const router = express.Router();
const axios = require("axios");
const path = require("path");

// Load environment variables
require("dotenv").config();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Import the data-layers module
const dataLayers = require("../../data-layers");

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
    CACHE_DIR: path.join(__dirname, "../cache"),
  },
});

// Test GET route for verification
router.get("/data-layers", (req, res) => {
  console.log("GET request received for data-layers test endpoint");
  res.send("Solar API data-layers endpoint is working");
});

/**
 * POST endpoint to fetch data layers
 */
router.post("/data-layers", async (req, res) => {
  try {
    const { location, radius = 50, layerType = "monthlyFlux" } = req.body;

    if (!location || !location.latitude || !location.longitude) {
      return res.status(400).json({ error: "Invalid location data" });
    }

    console.log(
      `Processing data layers for location: ${location.latitude}, ${location.longitude}`
    );

    // Use the layer manager to process the requested layer
    try {
      const result = await layerManager.processLayer(layerType, location, {
        radius,
        buildingFocus: true,
        fallbackToSynthetic: false, // Return errors instead of synthetic data
      });

      // Return the processed data
      return res.json({
        imageryQuality:
          result.processedData?.metadata?.imageryQuality || "MEDIUM",
        monthlyDataUrls: Array.isArray(result.visualization)
          ? result.visualization
          : [result.visualization],
        synthetic: result.synthetic || false,
        metadata: result.metadata,
      });
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
        });
      }

      // Other errors are returned as 500
      throw error;
    }
  } catch (error) {
    console.error("Data layers error:", error);

    // Return error response
    res.status(500).json({
      error: error.message || "Failed to fetch solar data",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

module.exports = router;
