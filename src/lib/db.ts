import mongoose from "mongoose";
const uri=process.env.MONGODB_URI;if(!uri)throw new Error("MONGODB_URI is not configured");
type Cache={conn:typeof mongoose|null;promise:Promise<typeof mongoose>|null};const g=global as typeof globalThis&{mongoCache?:Cache};const c=g.mongoCache??(g.mongoCache={conn:null,promise:null});
export async function connectDB(){if(c.conn)return c.conn;c.promise??=mongoose.connect(uri,{bufferCommands:false});c.conn=await c.promise;return c.conn;}
