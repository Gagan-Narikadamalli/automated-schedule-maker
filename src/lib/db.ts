import mongoose from "mongoose";

type MongooseCache = {
  connection: typeof mongoose | null;
  connectionPromise: Promise<typeof mongoose> | null;
};

declare global {
  // Reuse the MongoDB connection during local hot reloads and across
  // serverless invocations when the runtime keeps the process warm.
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

function getMongoDbUri(): string {
  const mongoDbUri = process.env.MONGODB_URI;

  if (!mongoDbUri) {
    throw new Error(
      "MONGODB_URI is not configured. Add it to .env.local locally and to the Vercel project environment variables."
    );
  }

  return mongoDbUri;
}

const cache: MongooseCache = global.mongooseCache ?? {
  connection: null,
  connectionPromise: null,
};

global.mongooseCache = cache;

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.connection) {
    return cache.connection;
  }

  if (!cache.connectionPromise) {
    const mongoDbUri = getMongoDbUri();

    cache.connectionPromise = mongoose.connect(mongoDbUri, {
      bufferCommands: false,
    });
  }

  try {
    cache.connection = await cache.connectionPromise;
    return cache.connection;
  } catch (error) {
    cache.connectionPromise = null;
    throw error;
  }
}
