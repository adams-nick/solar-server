// src/api/routes/trainingRoutes.js
const express = require("express");
const router = express.Router();
const {
  saveTrainingData,
  testR2Connection,
  getTrainingDataStats,
} = require("../../services/r2TrainingService");

/**
 * Validates training data schema
 * @param {Object} data - Request body data
 * @returns {Object} - { isValid: boolean, errors: string[] }
 */
function validateTrainingDataSchema(data) {
  const errors = [];

  // Required fields validation
  const requiredFields = [
    "rgb_image",
    "prompts",
    "accepted_polygons",
    "quality_score",
    "image_dimensions",
    "location",
    "created_at",
  ];

  for (const field of requiredFields) {
    if (!(field in data)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // If basic required fields are missing, return early
  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // RGB Image validation
  if (typeof data.rgb_image !== "string" || data.rgb_image.length === 0) {
    errors.push("rgb_image must be a non-empty string");
  } else if (!data.rgb_image.startsWith("data:image/")) {
    errors.push("rgb_image must be a valid base64 data URL");
  }

  // Prompts validation
  if (!Array.isArray(data.prompts)) {
    errors.push("prompts must be an array");
  } else {
    data.prompts.forEach((prompt, index) => {
      if (!prompt.type || !["box", "point"].includes(prompt.type)) {
        errors.push(`prompts[${index}].type must be 'box' or 'point'`);
      }

      if (!prompt.coordinates || typeof prompt.coordinates !== "object") {
        errors.push(`prompts[${index}].coordinates must be an object`);
      } else {
        if (prompt.type === "box") {
          const required = ["min_x", "min_y", "max_x", "max_y"];
          for (const coord of required) {
            if (typeof prompt.coordinates[coord] !== "number") {
              errors.push(
                `prompts[${index}].coordinates.${coord} must be a number`
              );
            }
          }
        } else if (prompt.type === "point") {
          if (
            typeof prompt.coordinates.x !== "number" ||
            typeof prompt.coordinates.y !== "number"
          ) {
            errors.push(
              `prompts[${index}].coordinates must have x and y as numbers`
            );
          }
          if (
            prompt.coordinates.label !== undefined &&
            ![0, 1].includes(prompt.coordinates.label)
          ) {
            errors.push(
              `prompts[${index}].coordinates.label must be 0 or 1 if provided`
            );
          }
        }
      }

      // Optional metadata fields for prompts
      if (prompt.azimuth !== undefined && typeof prompt.azimuth !== "number") {
        errors.push(`prompts[${index}].azimuth must be a number if provided`);
      }
      if (prompt.pitch !== undefined && typeof prompt.pitch !== "number") {
        errors.push(`prompts[${index}].pitch must be a number if provided`);
      }
      if (
        prompt.suitability !== undefined &&
        typeof prompt.suitability !== "number"
      ) {
        errors.push(
          `prompts[${index}].suitability must be a number if provided`
        );
      }
    });
  }

  // Accepted polygons validation
  if (!Array.isArray(data.accepted_polygons)) {
    errors.push("accepted_polygons must be an array");
  } else {
    data.accepted_polygons.forEach((polygon, index) => {
      if (!polygon.id || typeof polygon.id !== "string") {
        errors.push(
          `accepted_polygons[${index}].id must be a non-empty string`
        );
      }

      if (!Array.isArray(polygon.polygon)) {
        errors.push(`accepted_polygons[${index}].polygon must be an array`);
      } else if (polygon.polygon.length < 3) {
        errors.push(
          `accepted_polygons[${index}].polygon must have at least 3 points`
        );
      } else {
        polygon.polygon.forEach((point, pointIndex) => {
          if (typeof point.x !== "number" || typeof point.y !== "number") {
            errors.push(
              `accepted_polygons[${index}].polygon[${pointIndex}] must have x and y as numbers`
            );
          }
        });
      }

      if (typeof polygon.confidence !== "number" || polygon.confidence < 0) {
        errors.push(
          `accepted_polygons[${index}].confidence must be a positive number`
        );
      }

      if (typeof polygon.area !== "number" || polygon.area < 0) {
        errors.push(
          `accepted_polygons[${index}].area must be a positive number`
        );
      }
    });
  }

  // Quality score validation
  if (typeof data.quality_score !== "number") {
    errors.push("quality_score must be a number");
  } else if (
    !Number.isInteger(data.quality_score) ||
    data.quality_score < 0 ||
    data.quality_score > 5
  ) {
    errors.push("quality_score must be an integer between 0 and 5");
  }

  // Image dimensions validation
  if (!data.image_dimensions || typeof data.image_dimensions !== "object") {
    errors.push("image_dimensions must be an object");
  } else {
    if (
      typeof data.image_dimensions.width !== "number" ||
      data.image_dimensions.width <= 0
    ) {
      errors.push("image_dimensions.width must be a positive number");
    }
    if (
      typeof data.image_dimensions.height !== "number" ||
      data.image_dimensions.height <= 0
    ) {
      errors.push("image_dimensions.height must be a positive number");
    }
  }

  // Location validation
  if (!data.location || typeof data.location !== "object") {
    errors.push("location must be an object");
  } else {
    if (
      typeof data.location.latitude !== "number" ||
      data.location.latitude < -90 ||
      data.location.latitude > 90
    ) {
      errors.push("location.latitude must be a number between -90 and 90");
    }
    if (
      typeof data.location.longitude !== "number" ||
      data.location.longitude < -180 ||
      data.location.longitude > 180
    ) {
      errors.push("location.longitude must be a number between -180 and 180");
    }
  }

  // Timestamp validation
  if (typeof data.created_at !== "string") {
    errors.push("created_at must be a string");
  } else {
    const date = new Date(data.created_at);
    if (isNaN(date.getTime())) {
      errors.push("created_at must be a valid ISO date string");
    }
  }

  // Business logic validations
  if (data.quality_score === 0) {
    errors.push("quality_score cannot be 0 for accepted training data");
  }

  // Data size validations (to prevent abuse)
  if (data.prompts.length > 50) {
    errors.push("prompts array cannot exceed 50 items");
  }

  if (data.accepted_polygons.length > 20) {
    errors.push("accepted_polygons array cannot exceed 20 items");
  }

  // Check for reasonable polygon complexity
  data.accepted_polygons.forEach((polygon, index) => {
    if (polygon.polygon.length > 100) {
      errors.push(
        `accepted_polygons[${index}].polygon cannot exceed 100 points`
      );
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * POST /api/v1/training/submit-feedback
 *
 * Accepts training data feedback from the frontend
 */
router.post("/submit-feedback", async (req, res) => {
  try {
    console.log("Received training data submission");

    // Validate the request body schema
    const validation = validateTrainingDataSchema(req.body);

    if (!validation.isValid) {
      console.log("Training data validation failed:", validation.errors);
      return res.status(400).json({
        success: false,
        message: "Invalid training data format",
        errors: validation.errors,
      });
    }

    const dataToR2 = {
      rgb_image: req.body.rgb_image,
      prompts: req.body.prompts,
      segments: req.body.accepted_polygons,
      quality_score: req.body.quality_score,
      created_at: req.body.created_at,
      location: req.body.location,
    };

    console.log("Training data saved:", dataToR2);

    // Save to R2 bucket
    await saveTrainingData(dataToR2);

    // Return success response
    return res.status(200).json({
      success: true,
      message: "Training data received successfully",
      created_at: req.body.created_at,
      data_summary: {
        quality_score: req.body.quality_score,
        segment_count: req.body.accepted_polygons.length,
        prompt_count: req.body.prompts.length,
      },
    });
  } catch (error) {
    console.error("Error processing training data submission:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error processing training data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * GET /api/v1/training/health
 *
 * Health check endpoint for training data collection
 */
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "training-data-collection",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
