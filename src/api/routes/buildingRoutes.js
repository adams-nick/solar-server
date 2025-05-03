// src/api/routes/buildingRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");

// Test endpoint to verify routes are working
router.get("/test", (req, res) => {
  res.json({ message: "Building routes are working" });
});

// Endpoint to fetch building footprints from OpenStreetMap
router.get("/footprints", async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      console.log("Missing parameters:", { lat, lng });
      return res.status(400).json({
        error: "Missing required parameters",
        details: "Both lat and lng are required",
      });
    }

    console.log("Fetching footprints for:", lat, lng);

    // Create a bounding box around the location - increased radius to 0.005 (roughly 500 meters)
    const bbox = [
      parseFloat(lat) - 0.005, // south
      parseFloat(lng) - 0.005, // west
      parseFloat(lat) + 0.005, // north
      parseFloat(lng) + 0.005, // east
    ];

    console.log("Bounding box:", bbox);

    // Overpass API query to get buildings
    const query = `
      [out:json];
      (
        way["building"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
        relation["building"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
      );
      out geom;
    `;

    console.log("Sending query to Overpass API");

    // Add timeout to API request
    const response = await axios({
      method: "POST",
      url: "https://overpass-api.de/api/interpreter",
      data: query,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 10000, // 10 second timeout
    });

    console.log(
      `Received response from Overpass API. Status: ${response.status}`
    );
    console.log(
      `Found ${response.data.elements?.length || 0} elements from OSM`
    );

    // Return the building data
    res.json({
      source: "openstreetmap",
      data: response.data,
    });
  } catch (error) {
    console.error("Error fetching building footprints:");

    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error(`API Response Status: ${error.response.status}`);
      console.error("API Response Headers:", error.response.headers);
      console.error("API Response Data:", error.response.data);

      return res.status(error.response.status).json({
        error: "API error",
        details: error.response.data,
        status: error.response.status,
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error("No response received from API");
      console.error("Request details:", error.request);

      return res.status(504).json({
        error: "No response from API",
        details:
          "The request was sent but no response was received from the Overpass API",
      });
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error("Error setting up request:", error.message);
      console.error("Error stack:", error.stack);

      return res.status(500).json({
        error: "Failed to fetch building footprints",
        details: error.message,
      });
    }
  }
});

module.exports = router;
