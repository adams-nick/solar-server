// src/api/routes/solarRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");

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

    // Return the solar data
    return res.json({
      source: "google-solar-api",
      buildingType,
      buildingId,
      data: response.data,
    });
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
