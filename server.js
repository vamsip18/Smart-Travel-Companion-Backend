import express from "express";
import axios from "axios";
import cors from "cors";
import mysql from "mysql2";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 8000;

// Database connection
const db = mysql.createConnection({
  host: "sql5.freesqldatabase.com",
  user: "sql5790350",
  password: "mqQbnl6pw8",
  database: "sql5790350",
});


// const db = mysql.createConnection({
//   host: "sql207.infinityfree.com",
//   user: "if0_39485960 ",
//   password: "srvagaaf",
//   database: "if0_39485960_travel"
// });

// Connect to the database
db.connect((err) => {
  if (err) {
    db = mysql.createConnection({
      host: "sql207.infinityfree.com",
      user: "if0_39485960 ",
      password: "srvagaaf",
      database: "if0_39485960_travel"
    });
    // console.error("Database connection failed:", err);
  } else {
    console.log("Connected to MySQL Database");
  }
});

// Middleware
app.use(express.json());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: [
      "https://smart-travel-companion-backend.onrender.com",
      "http://localhost:5173",
      "http://localhost:8000",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

// Helper functions
const coordinateCache = new Map();

const getCoordinates = async (location) => {
  const cacheKey = encodeURIComponent(location);
  if (coordinateCache.has(cacheKey)) {
    const { coords, timestamp } = coordinateCache.get(cacheKey);
    if (Date.now() - timestamp < 24 * 60 * 60 * 1000) { // 24-hour cache
      return coords;
    }
  }

  // Respect rate limit with a 1-second delay
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/search?q=${cacheKey}&format=json&limit=1`,
      {
        headers: {
          "User-Agent": "SmartTravelCompanion/1.0 peelavamsi147@gmail.com", // Replace with your email
        },
      }
    );
    if (response.data.length > 0) {
      const { lat, lon } = response.data[0];
      const coords = { latitude: lat, longitude: lon };
      coordinateCache.set(cacheKey, { coords, timestamp: Date.now() });
      return coords;
    }
    throw new Error("No coordinates found for the given location.");
  } catch (error) {
    console.error("Error fetching coordinates:", error.message, error.stack);
    throw error;
  }
};

const fetchImageFromUnsplash = async (query) => {
  try {
    const unsplashAPI = "https://api.unsplash.com/photos/random";
    const headers = {
      Authorization: `Client-ID ${process.env.UNSPLASH_API_KEY}`,
    };
    const response = await axios.get(unsplashAPI, {
      headers,
      params: {
        query: query,
        orientation: "landscape",
      },
    });

    if (response.data.urls) {
      return response.data.urls.small;
    } else {
      return "https://via.placeholder.com/250x150.png?text=No+Image";
    }
  } catch (error) {
    console.error("Error fetching image from Unsplash:", error.message);
    return "https://via.placeholder.com/250x150.png?text=No+Image";
  }
};

const fetchPlaces = async (location, query) => {
  const { latitude, longitude } = await getCoordinates(location);

  const foursquareAPI = "https://api.foursquare.com/v3/places/search";
  const headers = {
    Accept: "application/json",
    Authorization: process.env.FOURSQUARE_API_KEY,
  };

  try {
    const response = await axios.get(foursquareAPI, {
      headers,
      params: {
        ll: `${latitude},${longitude}`,
        query: query,
        radius: 5000,
        limit: 10,
      },
    });

    const places = response.data.results || [];

    const placesWithImages = await Promise.all(
      places.map(async (place) => {
        let photo = "https://via.placeholder.com/250x150.png?text=No+Image";
        try {
          const photoResponse = await axios.get(
            `https://api.foursquare.com/v3/places/${place.fsq_id}/photos`,
            { headers }
          );
          const photos = photoResponse.data;
          if (photos.length > 0) {
            photo = `${photos[0].prefix}original${photos[0].suffix}`;
          } else {
            photo = await fetchImageFromUnsplash(query);
          }
        } catch (error) {
          console.warn("Error fetching Foursquare photo:", error.message);
          photo = await fetchImageFromUnsplash(query);
        }

        return {
          id: place.fsq_id,
          name: place.name,
          location: place.location,
          geocodes: place.geocodes,
          photo,
        };
      })
    );

    return placesWithImages;
  } catch (error) {
    console.error(`Error fetching ${query}:`, error.message, error.stack);
    return [];
  }
};

// Get user ID from email
app.get("/get-user-id", (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  db.query("SELECT id FROM users WHERE email = ?", [email], (err, results) => {
    if (err) {
      console.error("Error fetching user ID:", err);
      return res.status(500).json({ error: "Failed to fetch user ID" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ userId: results[0].id });
  });
});

// GET user details by email
app.get("/get-user-details", (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  const sql = "SELECT fullname, phone, created_at FROM users WHERE email = ?";
  db.query(sql, [email], (err, results) => {
    if (err) {
      console.error("Error fetching user details:", err);
      return res.status(500).json({ message: "Server error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = results[0];
    res.json({
      full_name: user.fullname,
      phone_number: user.phone,
      created_at: user.created_at,
    });
  });
});

// PUT /update-user-details
app.put("/update-user-details", async (req, res) => {
  const { email, full_name, phone_number } = req.body;

  if (!email || !full_name || !phone_number) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const updateQuery = `
      UPDATE users
      SET fullname = ?, phone = ?
      WHERE email = ?
    `;

    await db.promise().query(updateQuery, [full_name, phone_number, email]);

    const [updatedUser] = await db.promise().query(
      "SELECT email, fullname, phone FROM users WHERE email = ?",
      [email]
    );

    res.json(updatedUser[0]);
  } catch (error) {
    console.error("Error updating user details:", error);
    res.status(500).json({ error: "Failed to update user details" });
  }
});

// Save restaurant to profile
app.post("/save-restaurant", (req, res) => {
  const { user_id, restaurantId, name, address, photo, latitude, longitude } = req.body;

  const query = `
    INSERT INTO saved_restaurants (user_id, restaurant_id, name, address, photo, latitude, longitude)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE name=?, address=?, photo=?, latitude=?, longitude=?
  `;
  db.query(
    query,
    [
      user_id,
      restaurantId,
      name,
      address,
      photo,
      latitude,
      longitude,
      name,
      address,
      photo,
      latitude,
      longitude,
    ],
    (err, result) => {
      if (err) {
        console.error("Error saving restaurant:", err);
        return res.status(500).json({ error: "Failed to save restaurant" });
      }
      res.status(200).json({ message: "Restaurant saved successfully!" });
    }
  );
});

// Get saved restaurants for a user
app.get("/saved-restaurants/:userId", (req, res) => {
  const userId = req.params.userId;
  db.query(
    "SELECT id, restaurant_id, name, address, photo, latitude, longitude FROM saved_restaurants WHERE user_id = ?",
    [userId],
    (err, results) => {
      if (err) {
        console.error("SQL Error:", err);
        return res.status(500).json({ error: err.message });
      }
      res.json(results);
    }
  );
});

// Delete a saved restaurant by ID
app.delete("/delete-restaurant/:id", (req, res) => {
  const restaurantId = req.params.id;
  db.query(
    "DELETE FROM saved_restaurants WHERE id = ?",
    [restaurantId],
    (err, result) => {
      if (err) {
        console.error("Error deleting restaurant:", err);
        return res.status(500).json({ error: "Failed to delete restaurant" });
      }
      res.json({ success: true, message: "Restaurant deleted successfully" });
    }
  );
});

// Unsave restaurant for a user
app.post("/delete-restaurant", (req, res) => {
  const { user_id, restaurantId } = req.body;
  if (!user_id || !restaurantId) {
    return res.status(400).json({ message: "Missing required parameters" });
  }
  const query =
    "DELETE FROM saved_restaurants WHERE user_id = ? AND restaurant_id = ?";
  db.query(query, [user_id, restaurantId], (err, result) => {
    if (err) {
      console.error("Error deleting restaurant:", err);
      return res.status(500).json({ message: "Error deleting restaurant" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Restaurant not found" });
    }
    res.json({ message: "Restaurant unsaved successfully" });
  });
});

// Save hospital to profile
app.post("/save-hospital", (req, res) => {
  const { userId, hospitalId, name, address, photo, latitude, longitude } = req.body;
  if (!userId) {
    return res.status(401).json({ error: "User not logged in" });
  }
  const query = `
    INSERT INTO saved_hospitals (user_id, hospital_id, name, address, photo, latitude, longitude)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    address = VALUES(address),
    photo = VALUES(photo),
    latitude = VALUES(latitude),
    longitude = VALUES(longitude)
  `;
  db.query(
    query,
    [userId, hospitalId, name, address, photo, latitude, longitude],
    (err, result) => {
      if (err) {
        console.error("Error saving hospital:", err);
        return res.status(500).json({ error: "Failed to save hospital" });
      }
      res.status(200).json({ message: "Hospital saved successfully!" });
    }
  );
});

// Get saved hospitals for a user
app.get("/saved-hospitals/:userId", (req, res) => {
  const userId = req.params.userId;
  db.query(
    "SELECT id, hospital_id, name, address, photo, latitude, longitude FROM saved_hospitals WHERE user_id = ?",
    [userId],
    (err, results) => {
      if (err) {
        console.error("Error fetching saved hospitals:", err);
        return res.status(500).json({ error: "Failed to fetch saved hospitals" });
      }
      res.json(results);
    }
  );
});

// Delete a saved hospital by ID
app.delete("/delete-hospital/:id", (req, res) => {
  const hospitalId = req.params.id;
  db.query(
    "DELETE FROM saved_hospitals WHERE id = ?",
    [hospitalId],
    (err, result) => {
      if (err) {
        console.error("Error deleting hospital:", err);
        return res.status(500).json({ error: "Failed to delete hospital" });
      }
      res.json({ success: true, message: "Hospital deleted successfully" });
    }
  );
});

// Unsave hospital for a user
app.post("/delete-hospital", (req, res) => {
  const { userId, hospitalId } = req.body;
  if (!userId || !hospitalId) {
    return res.status(400).json({ message: "Missing required parameters" });
  }
  const query = "DELETE FROM saved_hospitals WHERE user_id = ? AND hospital_id = ?";
  db.query(query, [userId, hospitalId], (err, result) => {
    if (err) {
      console.error("Error deleting hospital:", err);
      return res.status(500).json({ message: "Error deleting hospital" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Hospital not found" });
    }
    res.json({ message: "Hospital unsaved successfully" });
  });
});

// Save live event to profile
app.post("/save-event", (req, res) => {
  const {
    userId,
    eventId,
    name,
    venue,
    city,
    country,
    date,
    time,
    latitude,
    longitude,
    image,
    url,
  } = req.body;
  if (!userId) {
    return res.status(401).json({ error: "User not logged in" });
  }
  if (!eventId) {
    return res.status(400).json({ error: "Missing event ID" });
  }
  const query = `
    INSERT INTO saved_events (user_id, event_id, name, venue, city, country, date, time, latitude, longitude, image, url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE name=?, venue=?, city=?, country=?, date=?, time=?, latitude=?, longitude=?, image=?, url=?
  `;
  db.query(
    query,
    [
      userId,
      eventId,
      name,
      venue,
      city,
      country,
      date,
      time,
      latitude,
      longitude,
      image,
      url,
      name,
      venue,
      city,
      country,
      date,
      time,
      latitude,
      longitude,
      image,
      url,
    ],
    (err, result) => {
      if (err) {
        console.error("Error saving event:", err);
        return res.status(500).json({ error: "Failed to save event" });
      }
      res.status(200).json({ message: "Event saved successfully!" });
    }
  );
});

// Get saved live events for a user
app.get("/saved-events/:userId", (req, res) => {
  const userId = req.params.userId;
  db.query(
    "SELECT id, event_id, name, venue, city, country, date, time, latitude, longitude, image, url FROM saved_events WHERE user_id = ?",
    [userId],
    (err, results) => {
      if (err) {
        console.error("Error fetching saved events:", err);
        return res.status(500).json({ error: "Failed to fetch saved events" });
      }
      res.json(results);
    }
  );
});

// Delete saved event by ID
app.delete("/delete-event/:id", (req, res) => {
  const eventId = req.params.id;
  db.query("DELETE FROM saved_events WHERE id = ?", [eventId], (err, result) => {
    if (err) {
      console.error("Error deleting event:", err);
      return res.status(500).json({ error: "Failed to delete event" });
    }
    res.json({ success: true, message: "Event deleted successfully" });
  });
});

// Delete saved event by user ID and event ID
app.post("/delete-event", (req, res) => {
  const { userId, eventId } = req.body;
  if (!userId || !eventId) {
    return res.status(400).json({ message: "Missing required parameters" });
  }
  const query = "DELETE FROM saved_events WHERE user_id = ? AND event_id = ?";
  db.query(query, [userId, eventId], (err, result) => {
    if (err) {
      console.error("Error deleting event:", err);
      return res.status(500).json({ message: "Error deleting event" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Event not found" });
    }
    res.json({ message: "Event unsaved successfully" });
  });
});

// Save a place to profile
app.post("/save-place", (req, res) => {
  const { userId, placeId, name, address, latitude, longitude, image } = req.body;
  if (!userId) {
    return res.status(401).json({ error: "User not logged in" });
  }
  const query = `
    INSERT INTO saved_places (user_id, place_id, name, address, latitude, longitude, image)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      address = VALUES(address),
      latitude = VALUES(latitude),
      longitude = VALUES(longitude),
      image = VALUES(image)
  `;
  db.query(
    query,
    [userId, placeId, name, address, latitude, longitude, image],
    (err, result) => {
      if (err) {
        console.error("Error saving place:", err);
        return res.status(500).json({ error: "Failed to save place" });
      }
      res.json({ success: true, message: "Place saved successfully" });
    }
  );
});

// Delete a saved place
app.post("/delete-place", (req, res) => {
  const { userId, placeId } = req.body;
  const query = "DELETE FROM saved_places WHERE user_id = ? AND place_id = ?";
  db.query(query, [userId, placeId], (err, result) => {
    if (err) {
      console.error("Error deleting place:", err);
      return res.status(500).json({ error: "Failed to delete place" });
    }
    res.json({ success: true, message: "Place deleted successfully" });
  });
});

// Get saved places for a user
app.get("/saved-places/:userId", (req, res) => {
  const userId = req.params.userId;
  const query = "SELECT * FROM saved_places WHERE user_id = ?";
  db.query(query, [userId], (err, results) => {
    if (err) {
      console.error("Error fetching saved places:", err);
      return res.status(500).json({ error: "Failed to fetch saved places" });
    }
    res.json(results);
  });
});

// Save a site to profile
app.post("/save-site", (req, res) => {
  const { userId, siteId, name, address, photo, latitude, longitude } = req.body;
  if (!userId) {
    return res.status(401).json({ error: "User not logged in" });
  }
  const query = `
    INSERT INTO saved_sites (user_id, site_id, name, address, photo, latitude, longitude)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      address = VALUES(address),
      photo = VALUES(photo),
      latitude = VALUES(latitude),
      longitude = VALUES(longitude)
  `;
  db.query(
    query,
    [userId, siteId, name, address, photo, latitude, longitude],
    (err, result) => {
      if (err) {
        console.error("Error saving site:", err);
        return res.status(500).json({ error: "Failed to save site" });
      }
      res.json({ success: true, message: "Site saved successfully" });
    }
  );
});

// Delete a saved site
app.post("/delete-site", (req, res) => {
  const { userId, siteId } = req.body;
  const query = "DELETE FROM saved_sites WHERE user_id = ? AND site_id = ?";
  db.query(query, [userId, siteId], (err, result) => {
    if (err) {
      console.error("Error deleting site:", err);
      return res.status(500).json({ error: "Failed to delete site" });
    }
    res.json({ success: true, message: "Site deleted successfully" });
  });
});

app.get("/saved-sites/:userId", (req, res) => {
  const userId = req.params.userId;
  const query = "SELECT * FROM saved_sites WHERE user_id = ?";
  db.query(query, [userId], (err, results) => {
    if (err) {
      console.error("Error fetching saved sites:", err);
      return res.status(500).json({ error: "Failed to fetch saved sites" });
    }
    res.json(results);
  });
});

// Serve static images from public folder
app.use("/assets", express.static(path.join(__dirname, "public/assets")));

// Religious Sites Route
app.get("/religious-sites", async (req, res) => {
  const { location } = req.query;
  if (!location) {
    return res.status(400).json({ error: "Location parameter is required." });
  }

  const backupImages = {
    temple: Array.from({ length: 16 }, (_, i) => `/assets/images/Temples/Temple${i + 1}.jpg`),
    church: Array.from({ length: 16 }, (_, i) => `/assets/images/churches/church${i + 1}.jpg`),
    mosque: Array.from({ length: 16 }, (_, i) => `/assets/images/Mosques/mosque${i + 1}.jpg`),
  };

  try {
    const foursquareUrl = `https://api.foursquare.com/v3/places/search?query=temple,church,mosque&near=${location}&limit=16`;

    const response = await axios.get(foursquareUrl, {
      headers: {
        Authorization: process.env.FOURSQUARE_API_KEY,
      },
    });

    const places = response.data.results || [];

    const usedIndexes = {
      temple: new Set(),
      church: new Set(),
      mosque: new Set(),
    };

    const placesWithImages = await Promise.all(
      places.map(async (place) => {
        let imageUrl = "";

        try {
          const photoResponse = await axios.get(
            `https://api.foursquare.com/v3/places/${place.fsq_id}/photos`,
            {
              headers: {
                Authorization: process.env.FOURSQUARE_API_KEY,
              },
            }
          );

          if (photoResponse.data.length > 0) {
            imageUrl = `${photoResponse.data[0].prefix}300x300${photoResponse.data[0].suffix}`;
          } else {
            throw new Error("No Foursquare photos available.");
          }
        } catch (fsqError) {
          console.warn(`Foursquare image error for ${place.fsq_id}: ${fsqError.message}`);

          const lowerName = place.name.toLowerCase();
          let category = "temple";

          if (lowerName.includes("church")) {
            category = "church";
          } else if (lowerName.includes("mosque") || lowerName.includes("masjid")) {
            category = "mosque";
          }

          const availableImages = backupImages[category];
          const used = usedIndexes[category];

          let uniqueIndex;
          for (let i = 0; i < availableImages.length; i++) {
            if (!used.has(i)) {
              uniqueIndex = i;
              used.add(i);
              break;
            }
          }

          imageUrl = availableImages[uniqueIndex] || "/assets/images/default.jpg";
        }

        return {
          fsq_id: place.fsq_id,
          name: place.name,
          address: place.location?.formatted_address || "Address not available",
          geocodes: place.geocodes,
          image: imageUrl,
        };
      })
    );

    res.json(placesWithImages);
  } catch (error) {
    console.error("Error fetching religious sites:", error.message, error.stack);
    res.status(500).json({
      error: "Failed to fetch religious sites.",
      details: error.message,
    });
  }
});

// Fetch live events
app.get("/live-events", async (req, res) => {
  const { location, date: eventDate } = req.query;
  if (!location || !eventDate) {
    return res.status(400).json({ error: "Location and date are required" });
  }

  const ticketmasterAPI = "https://app.ticketmaster.com/discovery/v2/events.json";
  const params = {
    apikey: process.env.TICKETMASTER_API_KEY,
    city: location,
    startDateTime: `${eventDate}T00:00:00Z`,
    radius: 50,
    classificationName: "festival,cinema,comedy,music,sports",
    size: 16,
    sort: "date,asc",
  };

  try {
    const response = await axios.get(ticketmasterAPI, { params });
    if (response.data._embedded && response.data._embedded.events) {
      const events = response.data._embedded.events
        .filter((event) => event.dates.start.localDate === eventDate)
        .map((event) => ({
          id: event.id,
          name: event.name,
          venue: event._embedded.venues[0].name,
          address: event._embedded.venues[0].address.line1,
          city: event._embedded.venues[0].city.name,
          country: event._embedded.venues[0].country.name,
          date: event.dates.start.localDate,
          time: event.dates.start.localTime || "TBD",
          image: event.images[0]?.url || "",
          latitude: event._embedded.venues[0].location.latitude,
          longitude: event._embedded.venues[0].location.longitude,
        }));
      res.json(events);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error("Error fetching events:", error.message, error.stack);
    res.status(500).json({
      error: "Failed to fetch event data",
      details: error.message,
    });
  }
});

app.use("/assets", express.static(path.join(__dirname, "public/assets/images")));

// Fetch tourist places
app.get("/tourist-places", async (req, res) => {
  const { location } = req.query;

  if (!location) {
    return res.status(400).json({ error: "Location is required." });
  }

  const fallbackImages = Array.from({ length: 10 }, (_, i) =>
    `http://localhost:5173/assets/images/TouristPlaces/tourist${i + 1}.jpg`
  );

  try {
    const places = await fetchPlaces(location, "tourist_attraction");

    const usedFallbacks = new Set();

    const placesWithImages = await Promise.all(
      places.map(async (place) => {
        let imageUrl = "";

        try {
          const photoResponse = await axios.get(
            `https://api.foursquare.com/v3/places/${place.fsq_id}/photos`,
            {
              headers: {
                Authorization: process.env.FOURSQUARE_API_KEY,
              },
            }
          );

          if (photoResponse.data.length > 0) {
            imageUrl = `${photoResponse.data[0].prefix}300x300${photoResponse.data[0].suffix}`;
          } else {
            throw new Error("No image available.");
          }
        } catch (error) {
          const available = fallbackImages.filter((img) => !usedFallbacks.has(img));
          if (available.length > 0) {
            const selected = available[Math.floor(Math.random() * available.length)];
            usedFallbacks.add(selected);
            imageUrl = selected;
          } else {
            imageUrl = fallbackImages[Math.floor(Math.random() * fallbackImages.length)];
          }
        }

        return {
          fsq_id: place.fsq_id,
          name: place.name,
          address: place.location?.formatted_address || "Address not available",
          geocodes: place.geocodes,
          image: imageUrl,
        };
      })
    );

    res.json(placesWithImages);
  } catch (error) {
    console.error("Error fetching tourist places:", error.message, error.stack);
    res.status(500).json({
      error: "Failed to fetch tourist places.",
      details: error.message,
    });
  }
});

// Fetch restaurants
app.get("/restaurants", async (req, res) => {
  const { location, budget } = req.query;
  if (!location) {
    return res.status(400).json({ error: "Location is required." });
  }

  try {
    const { latitude, longitude } = await getCoordinates(location);

    const foursquareAPI = "https://api.foursquare.com/v3/places/search";
    const foursquarePhotoAPI = (venueId) =>
      `https://api.foursquare.com/v3/places/${venueId}/photos`;

    const headers = {
      Accept: "application/json",
      Authorization: process.env.FOURSQUARE_API_KEY,
    };

    const response = await axios.get(foursquareAPI, {
      headers,
      params: {
        ll: `${latitude},${longitude}`,
        query: "restaurant",
        radius: 5000,
        sort: "distance",
        price: budget,
        limit: 10,
      },
    });

    const restaurants = response.data.results || [];

    const staticFallbackImages = Array.from({ length: 9 }, (_, i) =>
      `http://localhost:5173/assets/images/restau/r${i + 1}.jpeg`
    );

    let usedFallbackIndexes = new Set();

    const restaurantData = await Promise.all(
      restaurants.map(async (restaurant) => {
        let photoUrl = "";

        try {
          const photoResponse = await axios.get(
            foursquarePhotoAPI(restaurant.fsq_id),
            { headers }
          );
          const photos = photoResponse.data;

          if (photos.length > 0) {
            photoUrl = `${photos[0].prefix}original${photos[0].suffix}`;
          } else {
            throw new Error("No Foursquare image available.");
          }
        } catch (error) {
          console.warn(
            `Error fetching Foursquare photo for ${restaurant.name}:`,
            error.message
          );

          const availableIndexes = staticFallbackImages
            .map((_, idx) => idx)
            .filter((i) => !usedFallbackIndexes.has(i));

          if (availableIndexes.length > 0) {
            const randomIndex =
              availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
            usedFallbackIndexes.add(randomIndex);
            photoUrl = staticFallbackImages[randomIndex];
          } else {
            photoUrl = await fetchImageFromUnsplash(restaurant.name);
          }
        }

        return {
          id: restaurant.fsq_id,
          name: restaurant.name,
          location: restaurant.location,
          photo: photoUrl,
          geocodes: restaurant.geocodes,
        };
      })
    );

    const filteredData = restaurantData.filter((item) => item !== null);
    res.json(filteredData);
  } catch (error) {
    console.error("Error fetching restaurants:", error.message, error.stack);
    res.status(500).json({
      error: "Failed to fetch restaurant data.",
      details: error.message,
    });
  }
});

// Fetch hospitals, clinics, and pharmacies
app.get("/:type", async (req, res) => {
  const { location } = req.query;
  const { type } = req.params;

  if (!location || !["hospitals", "clinics", "pharmacies"].includes(type)) {
    return res.status(400).json({ error: "Invalid request parameters." });
  }

  try {
    const { latitude, longitude } = await getCoordinates(location);

    const foursquareAPI = "https://api.foursquare.com/v3/places/search";
    const foursquarePhotoAPI = (venueId) =>
      `https://api.foursquare.com/v3/places/${venueId}/photos`;

    const headers = {
      Accept: "application/json",
      Authorization: process.env.FOURSQUARE_API_KEY,
    };

    const response = await axios.get(foursquareAPI, {
      headers,
      params: {
        ll: `${latitude},${longitude}`,
        query: type.slice(0, -1),
        radius: 5000,
        sort: "distance",
        limit: 10,
      },
    });

    const places = response.data.results || [];

    const staticFallbackImages = Array.from({ length: 9 }, (_, i) =>
      `http://localhost:5173/assets/images/hospitals/h${i + 1}.jpeg`
    );

    let usedFallbackIndexes = new Set();

    const processedPlaces = await Promise.all(
      places.map(async (place) => {
        let imageUrl = "";

        try {
          const photoResponse = await axios.get(foursquarePhotoAPI(place.fsq_id), {
            headers,
          });
          const photos = photoResponse.data;

          if (photos.length > 0) {
            imageUrl = `${photos[0].prefix}original${photos[0].suffix}`;
          } else {
            throw new Error("No photo available");
          }
        } catch (error) {
          console.warn(`Error fetching photo for ${place.name}:`, error.message);

          const availableIndexes = staticFallbackImages
            .map((_, idx) => idx)
            .filter((i) => !usedFallbackIndexes.has(i));

          if (availableIndexes.length > 0) {
            const randomIndex =
              availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
            usedFallbackIndexes.add(randomIndex);
            imageUrl = staticFallbackImages[randomIndex];
          } else {
            imageUrl = await fetchImageFromUnsplash(place.name);
          }
        }

        return {
          id: place.fsq_id,
          name: place.name,
          location: place.location,
          photo: imageUrl,
          geocodes: place.geocodes,
        };
      })
    );

    res.json(processedPlaces);
  } catch (error) {
    console.error(`Error fetching ${type}:`, error.message, error.stack);
    res.status(500).json({
      error: `Failed to fetch ${type} data.`,
      details: error.message,
    });
  }
});

// Create users table
db.query(
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    fullname VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(15) NOT NULL,
    password VARCHAR(255) NOT NULL
  )`,
  (err) => {
    if (err) {
      console.error("Error creating 'users' table:", err.message);
    } else {
      console.log("users table is ready");
    }
  }
);

// Register endpoint
app.post("/register", async (req, res) => {
  const { fullname, email, phone, password } = req.body;
  const userId = uuidv4();
  if (!fullname || !email || !phone || !password) {
    return res.status(400).json({
      success: false,
      message: "All fields are required!",
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.query(
      "INSERT INTO users (id, fullname, email, phone, password) VALUES (?, ?, ?, ?, ?)",
      [userId, fullname, email, phone, hashedPassword],
      (err) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
              success: false,
              message: "User with this email already exists!",
            });
          }
          console.error("Error inserting user:", err.message);
          return res.status(500).json({
            success: false,
            message: "Database error. Could not register user.",
          });
        }
        res.status(201).json({
          success: true,
          message: "Registration successful!",
        });
      }
    );
  } catch (err) {
    console.error("Error hashing password:", err.message);
    res.status(500).json({
      success: false,
      message: "Error during password encryption.",
    });
  }
});

// Login endpoint
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required!",
    });
  }

  db.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    async (err, results) => {
      if (err) {
        console.error("Database error:", err.message);
        return res.status(500).json({
          success: false,
          message: "Internal server error. Please try again later.",
        });
      }

      if (results.length === 0) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password!",
        });
      }

      const user = results[0];

      const passwordMatch = await bcrypt.compare(password, user.password);

      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password!",
        });
      }

      res.status(200).json({
        success: true,
        message: "Login successful!",
        user: {
          id: user.id,
          fullname: user.fullname,
          email: user.email,
          phone: user.phone,
        },
      });
    }
  );
});

// Profile endpoint
app.get("/profile/:id", (req, res) => {
  const userId = req.params.id;

  db.query(
    "SELECT id, fullname, email, phone FROM users WHERE id = ?",
    [userId],
    (err, results) => {
      if (err) {
        console.error("Error fetching user profile:", err.message);
        return res.status(500).json({
          success: false,
          message: "Error fetching user data.",
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      res.status(200).json({
        success: true,
        user: results[0],
      });
    }
  );
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
