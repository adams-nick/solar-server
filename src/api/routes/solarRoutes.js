// src/api/routes/solarRoutes.js - Updated with segment filtering

const express = require("express");
const router = express.Router();
const axios = require("axios");

// Import the data-layers module
const dataLayers = require("../../data-layers");
// Import the processor and visualizer directly
const RoofSegmentProcessor = require("../../data-layers/layers/roof-segments/roof-segments-processor");
const RoofSegmentVisualizer = require("../../data-layers/layers/roof-segments/roof-segments-visualizer");

// Create API client for the data layer manager
const apiClient = {
  apiKey: process.env.GOOGLE_MAPS_API_KEY,
  async get(url, options = {}) {
    return axios.get(url, options);
  },
};

// Create layer manager instance
const layerManager = dataLayers.createLayerManager(apiClient);

// Endpoint to fetch solar insights from Google Solar API
router.post("/buildingInsights", async (req, res) => {
  try {
    const { center, buildingType, footprint, buildingId } = req.body;

    if (!center || !center.latitude || !center.longitude) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: "Building center coordinates are required",
      });
    }

    console.log(
      `Processing solar request for ${buildingType} at ${center.latitude}, ${center.longitude}`
    );

    // Call Google Solar API
    const response = await axios({
      method: "GET",
      url: "https://solar.googleapis.com/v1/buildingInsights:findClosest",
      params: {
        "location.latitude": center.latitude,
        "location.longitude": center.longitude,
        requiredQuality: "HIGH",
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
      timeout: 30000,
    });

    console.log("Solar API response received");

    // Process the buildingInsights data to create roof segment visualization
    try {
      // Create processor and visualizer instances directly
      const roofSegmentProcessor = new RoofSegmentProcessor();
      const roofSegmentVisualizer = new RoofSegmentVisualizer();

      // Process the roof segment data
      const processedData = await roofSegmentProcessor.process(response.data);

      // Filter out segments that are too small to hold at least one panel
      const solarPotential = response.data.solarPotential;
      const panelWidth = solarPotential.panelWidthMeters || 1.045;
      const panelHeight = solarPotential.panelHeightMeters || 1.879;
      const minPanelArea = panelWidth * panelHeight;

      // Add some margin for installation constraints
      const installationFactor = 1.1; // 10% extra space needed for mounting
      const minSegmentArea = minPanelArea * installationFactor;

      // Filter the segments
      const viableSegments = processedData.roofSegments.filter((segment) => {
        // Check if segment is large enough for a panel
        const isLargeEnough = segment.area >= minSegmentArea;

        // Optionally, also check suitability
        const hasReasonableSuitability = segment.suitability > 0.2; // Minimum 20% suitability

        return isLargeEnough && hasReasonableSuitability;
      });

      console.log(
        `Filtered from ${processedData.roofSegments.length} to ${viableSegments.length} viable roof segments`
      );

      // Skip processing if no viable segments
      if (viableSegments.length === 0) {
        return res.json({
          source: "google-solar-api",
          buildingType,
          buildingId,
          data: response.data,
          roofSegments: {
            error: "No viable roof segments found",
            available: false,
          },
        });
      }

      // Create a new processed data object with filtered segments
      const filteredData = {
        ...processedData,
        roofSegments: viableSegments,
        metadata: {
          ...processedData.metadata,
          viableSegmentCount: viableSegments.length,
          originalSegmentCount: processedData.roofSegments.length,
        },
      };

      // Create visualizations with different color modes
      const suitabilityVisualization = await roofSegmentVisualizer.visualize(
        filteredData,
        {
          colorMode: "suitability",
          showLabels: true,
          showLegend: true,
        }
      );

      const orientationVisualization = await roofSegmentVisualizer.visualize(
        filteredData,
        {
          colorMode: "orientation",
          showLegend: true,
        }
      );

      // Calculate total viable area
      const totalViableArea = viableSegments.reduce(
        (sum, segment) => sum + segment.area,
        0
      );

      // Add the visualizations to the response
      const enhancedResponse = {
        source: "google-solar-api",
        buildingType,
        buildingId,
        data: response.data,
        // Add roof segment data and visualizations
        roofSegments: {
          data: viableSegments,
          visualizations: {
            suitability: suitabilityVisualization,
            orientation: orientationVisualization,
          },
          bounds: processedData.bounds,
          metadata: {
            totalViableArea: totalViableArea.toFixed(2),
            segmentCount: viableSegments.length,
            minPanelArea: minPanelArea.toFixed(2),
            originalSegmentCount: processedData.roofSegments.length,
          },
        },
      };

      return res.json(enhancedResponse);
    } catch (processingError) {
      console.error("Error processing roof segments:", processingError);

      // If roof segment processing fails, still return the original data
      return res.json({
        source: "google-solar-api",
        buildingType,
        buildingId,
        data: response.data,
        // Indicate that roof segment processing failed
        roofSegments: {
          error: processingError.message,
          available: false,
        },
      });
    }
  } catch (error) {
    console.error("Error fetching solar data:");

    if (error.response) {
      console.error(`API Response Status: ${error.response.status}`);
      console.error("API Response Data:", error.response.data);

      return res.status(error.response.status).json({
        error: "Solar API error",
        details: error.response.data,
        status: error.response.status,
      });
    } else if (error.request) {
      console.error("No response received from Solar API");

      return res.status(504).json({
        error: "No response from Solar API",
        details: "The request was sent but no response was received",
      });
    } else {
      console.error("Error setting up request:", error.message);

      return res.status(500).json({
        error: "Failed to fetch solar data",
        details: error.message,
      });
    }
  }
});

module.exports = router;
