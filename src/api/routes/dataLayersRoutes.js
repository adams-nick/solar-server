// src/api/routes/dataLayersRoutes.js
const express = require("express");
const router = express.Router();
const dataLayersController = require("../controllers/dataLayersController");
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
    CACHE_DIR: path.join(__dirname, "../../cache"),
  },
});

// Test GET route for verification
router.get("/", dataLayersController.testEndpoint);

// POST endpoint to fetch data layers
router.post("/", async (req, res) => {
  try {
    const {
      location,
      radius = 50,
      layerType = "annualFlux", // Default to annualFlux
      buildingFocus = true,
    } = req.body;

    if (!location || !location.latitude || !location.longitude) {
      return res.status(400).json({ error: "Invalid location data" });
    }

    console.log(
      `Processing ${layerType} for location: ${location.latitude}, ${location.longitude}`
    );

    try {
      // Process layer
      const result = await layerManager.processLayer(layerType, location, {
        radius,
        buildingFocus,
        fallbackToSynthetic: true,
      });

      // Return visualizations
      return res.json({
        imageryQuality: result.metadata?.imageryQuality || "MEDIUM",
        visualizations: result.visualization,
        synthetic: result.synthetic || false,
        metadata: result.metadata,
      });
    } catch (error) {
      // Handle common errors
      if (
        error.message &&
        (error.message.includes("empty data") ||
          error.message.includes("no data available") ||
          error.message.includes("Received empty data"))
      ) {
        return res.status(404).json({
          error: "No solar data available for this location",
          details: error.message,
          location,
        });
      }

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
