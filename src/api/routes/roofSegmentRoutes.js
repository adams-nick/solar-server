// src/api/routes/roofSegmentRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");

// ML server URL
const ML_SERVER_URL = "http://localhost:8000"; // Update if hosted elsewhere

// Endpoint to process roof segments
router.post("/segments", async (req, res) => {
  try {
    const { buildingId, rgbImage, buildingBox } = req.body;

    // Validate request
    if (!buildingId || !rgbImage || !buildingBox) {
      return res.status(400).json({
        error: "Missing required parameters",
      });
    }

    console.log(`Processing roof segments for building: ${buildingId}`);

    // Forward request to ML server
    const mlResponse = await axios.post(
      `${ML_SERVER_URL}/api/predict`,
      {
        building_id: buildingId,
        rgb_image: rgbImage,
        building_box: buildingBox,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 30000, // 30 second timeout
      }
    );

    // Return the ML server response
    return res.json(mlResponse.data);
  } catch (error) {
    console.error("Error processing roof segments:", error);

    // Return appropriate error
    if (error.response) {
      return res.status(error.response.status).json({
        error: "ML server error",
        details: error.response.data,
      });
    }

    return res.status(500).json({
      error: "Failed to process roof segments",
      details: error.message,
    });
  }
});

module.exports = router;
