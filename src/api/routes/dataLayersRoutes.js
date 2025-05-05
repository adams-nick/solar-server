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

// POST endpoint to fetch data layers (for all layers except RGB)
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

    // For RGB requests, redirect to the dedicated endpoint
    if (layerType === "rgb") {
      console.log(
        "RGB request received on main endpoint, redirecting to /rgb endpoint"
      );
      return res.status(400).json({
        error: "For RGB aerial imagery, please use the dedicated /rgb endpoint",
        suggestedEndpoint: "/api/v1/data-layers/rgb",
      });
    }

    console.log(
      `Processing ${layerType} for location: ${location.latitude}, ${location.longitude}`
    );

    try {
      // Process layer
      const result = await layerManager.processLayer(layerType, location, {
        radius,
        buildingFocus,
        fallbackToSynthetic: false,
      });

      // Format response based on layer type
      if (layerType === "monthlyFlux") {
        return res.json({
          imageryQuality: result.metadata?.imageryQuality || "MEDIUM",
          visualizations: Array.isArray(result.visualization)
            ? result.visualization
            : [result.visualization],
          monthlyDataUrls: Array.isArray(result.visualization)
            ? result.visualization
            : [result.visualization], // For compatibility with existing code
          layerType: "monthlyFlux",
          metadata: result.metadata,
        });
      } else if (layerType === "hourlyShade") {
        return res.json({
          imageryQuality: result.metadata?.imageryQuality || "MEDIUM",
          visualizations: Array.isArray(result.visualization)
            ? result.visualization
            : [result.visualization],
          hourlyDataUrls: Array.isArray(result.visualization)
            ? result.visualization
            : [result.visualization], // For compatibility with existing code
          layerType: "hourlyShade",
          metadata: result.metadata,
        });
      } else {
        // Generic response for other layer types (annualFlux, dsm, mask)
        return res.json({
          imageryQuality: result.metadata?.imageryQuality || "MEDIUM",
          visualizations: result.visualization,
          metadata: result.metadata,
          layerType,
        });
      }
    } catch (error) {
      // Handle common errors
      if (
        error.message &&
        (error.message.includes("empty data") ||
          error.message.includes("no data available") ||
          error.message.includes("Received empty data") ||
          error.message.includes("not available for this location"))
      ) {
        return res.status(404).json({
          error: `No ${layerType} data available for this location`,
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

// Dedicated POST endpoint for RGB layer
router.post("/rgb", async (req, res) => {
  try {
    const { location, radius = 50, buildingFocus = true } = req.body;

    if (!location || !location.latitude || !location.longitude) {
      return res.status(400).json({ error: "Invalid location data" });
    }

    console.log(
      `Processing RGB layer for location: ${location.latitude}, ${location.longitude}`
    );

    try {
      // Process RGB layer
      const result = await layerManager.processLayer("rgb", location, {
        radius,
        buildingFocus,
        fallbackToSynthetic: false,
      });

      // Simple, consistent response format
      return res.json({
        imageryQuality: result.metadata?.imageryQuality || "MEDIUM",
        dataUrl: result.visualization, // Single data URL
        layerType: "rgb",
        metadata: {
          ...result.metadata,
          dimensions: result.metadata.dimensions,
          hasMask: result.metadata.hasMask,
          buildingBoundaries: result.buildingBoundaries?.hasBuilding
            ? {
                exists: true,
                width: result.buildingBoundaries.width,
                height: result.buildingBoundaries.height,
              }
            : { exists: false },
        },
        bounds: result.bounds,
      });
    } catch (error) {
      // Handle RGB-specific errors
      if (
        error.message &&
        (error.message.includes("empty data") ||
          error.message.includes("no data available") ||
          error.message.includes("Received empty data") ||
          error.message.includes("RGB data is not available"))
      ) {
        return res.status(404).json({
          error: "No RGB aerial imagery available for this location",
          details: error.message,
          location,
        });
      }

      throw error;
    }
  } catch (error) {
    console.error("RGB data layer error:", error);

    // Return error response
    res.status(500).json({
      error: error.message || "Failed to fetch RGB aerial imagery",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Add a specific endpoint just for hourly shade layer
router.post("/hourly-shade", async (req, res) => {
  try {
    const {
      location,
      radius = 50,
      buildingFocus = true,
      month = 0, // Default to January
      day = 15, // Default to middle of month
    } = req.body;

    if (!location || !location.latitude || !location.longitude) {
      return res.status(400).json({ error: "Invalid location data" });
    }

    if (month < 0 || month > 11) {
      return res.status(400).json({ error: "Month must be between 0 and 11" });
    }

    if (day < 1 || day > 31) {
      return res.status(400).json({ error: "Day must be between 1 and 31" });
    }

    console.log(
      `Processing hourly shade for location: ${location.latitude}, ${location.longitude}, month: ${month}, day: ${day}`
    );

    try {
      // Process hourly shade layer
      const result = await layerManager.processLayer("hourlyShade", location, {
        radius,
        buildingFocus,
        month,
        day,
        fallbackToSynthetic: false,
      });

      // Return hourly shade visualizations
      return res.json({
        imageryQuality: result.metadata?.imageryQuality || "MEDIUM",
        hourlyDataUrls: Array.isArray(result.visualization)
          ? result.visualization
          : [result.visualization],
        layerType: "hourlyShade",
        metadata: {
          ...result.metadata,
          month,
          day,
          dimensions: result.metadata.dimensions,
          hasMask: result.metadata.hasMask,
        },
        bounds: result.bounds,
      });
    } catch (error) {
      // Handle specific errors
      if (
        error.message &&
        (error.message.includes("empty data") ||
          error.message.includes("no data available") ||
          error.message.includes("Received empty data") ||
          error.message.includes("not available for this location"))
      ) {
        return res.status(404).json({
          error: "No hourly shade data available for this location",
          details: error.message,
          location,
        });
      }

      throw error;
    }
  } catch (error) {
    console.error("Hourly shade data layer error:", error);

    // Return error response
    res.status(500).json({
      error: error.message || "Failed to fetch hourly shade data",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

module.exports = router;
