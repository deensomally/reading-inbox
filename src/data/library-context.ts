import { createContext, useContext } from "react";
import { db } from "./store";
export const LibraryContext = createContext(db);
export const useLibrary = () => useContext(LibraryContext);
