import { createStore, combineReducers } from "redux";
import { getPose } from "./pose";
const rootReducers = combineReducers({getPose})
export const store = createStore(rootReducers)