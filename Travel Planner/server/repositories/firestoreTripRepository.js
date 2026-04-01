import { getAdminDb } from "../lib/firebaseAdmin.js";

const COLLECTION_NAME = "AITrips";

function getTripsCollection() {
  return getAdminDb().collection(COLLECTION_NAME);
}

export function createFirestoreTripRepository() {
  return {
    driver: "firestore",

    async saveTrip(trip) {
      await getTripsCollection().doc(trip.id).set(trip);
      return trip;
    },

    async getTripById(tripId) {
      const snapshot = await getTripsCollection().doc(tripId).get();

      if (!snapshot.exists) {
        return null;
      }

      return {
        id: snapshot.id,
        ...snapshot.data(),
      };
    },

    async listTripsByUser(user) {
      const collection = getTripsCollection();
      const queries = [collection.where("ownerId", "==", user.uid).get()];

      if (user.email) {
        queries.push(collection.where("ownerEmail", "==", user.email).get());
        queries.push(collection.where("userEmail", "==", user.email).get());
      }

      const snapshots = await Promise.all(queries);
      const tripsById = new Map();

      for (const snapshot of snapshots) {
        snapshot.forEach((doc) => {
          tripsById.set(doc.id, {
            id: doc.id,
            ...doc.data(),
          });
        });
      }

      return [...tripsById.values()];
    },
  };
}
