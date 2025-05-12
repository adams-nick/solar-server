// src/api/routes/roofSegmentRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");

// ML server URL
const ML_SERVER_URL = "http://localhost:8000";

// Endpoint to process roof segments
router.post("/segments", async (req, res) => {
  try {
    const {
      buildingId,
      rgbImage,
      buildingBox,
      roofSegments,
      imageWidth,
      imageHeight,
      buildingBoundingBox,
      buildingCenter,
    } = req.body;

    // Validate request
    if (!buildingId || !rgbImage) {
      return res.status(400).json({
        error: "Missing required parameters",
      });
    }

    console.log(
      `Processing roof segments for building: ${buildingId} with roof segments providd: ${roofSegments}`
    );

    // Create request object
    const requestData = {
      building_id: buildingId,
      rgb_image: rgbImage,
      image_width: imageWidth || 400,
      image_height: imageHeight || 224,
    };

    // If buildingBox exists, format it for ML server
    if (buildingBox) {
      // Format building box in pixel coordinates
      const formattedBuildingBox = {
        min_x: Number(buildingBox.min_x || 0),
        min_y: Number(buildingBox.min_y || 0),
        max_x: Number(buildingBox.max_x || buildingBox.min_x || 0),
        max_y: Number(buildingBox.max_y || buildingBox.min_y || 0),
      };

      console.log("Formatted building box:", formattedBuildingBox);
      requestData.building_box = formattedBuildingBox;
    } else if (
      buildingBoundingBox &&
      buildingBoundingBox.ne &&
      buildingBoundingBox.sw
    ) {
      // If no explicit buildingBox is provided, create one from buildingBoundingBox
      const formattedBuildingBox = {
        min_x: 0,
        min_y: 0,
        max_x: requestData.image_width - 1,
        max_y: requestData.image_height - 1,
      };

      console.log("Using default building box:", formattedBuildingBox);
      requestData.building_box = formattedBuildingBox;
    }

    // Format roof segments if they exist
    if (
      roofSegments &&
      Array.isArray(roofSegments) &&
      roofSegments.length > 0
    ) {
      const formattedSegments = [];

      for (const segment of roofSegments) {
        // Check if segment has the expected properties
        if (
          segment.min_x !== undefined &&
          segment.min_y !== undefined &&
          segment.max_x !== undefined &&
          segment.max_y !== undefined
        ) {
          // Use the provided coordinates directly
          const formattedSegment = {
            min_x: Number(segment.min_x),
            min_y: Number(segment.min_y),
            max_x: Number(segment.max_x),
            max_y: Number(segment.max_y),
            id: String(segment.id || ""),
          };

          // Add optional fields only if they exist
          if (segment.azimuth !== undefined)
            formattedSegment.azimuth = Number(segment.azimuth);
          if (segment.pitch !== undefined)
            formattedSegment.pitch = Number(segment.pitch);
          if (segment.is_group !== undefined)
            formattedSegment.is_group = Boolean(segment.is_group);

          formattedSegments.push(formattedSegment);
        }
      }

      if (formattedSegments.length > 0) {
        console.log(
          `Sending ${formattedSegments.length} roof segments to ML server`
        );
        requestData.roof_segments = formattedSegments;
      }
    }

    // Log the request data (without image)
    const logData = { ...requestData };
    if (logData.rgb_image) logData.rgb_image = "[BASE64 IMAGE DATA]";
    console.log("Request data to ML server:", JSON.stringify(logData, null, 2));

    // Forward request to ML server
    const mlResponse = await axios.post(
      `${ML_SERVER_URL}/api/predict`,
      requestData,
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
      console.error("ML server error response:", error.response.data);
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
