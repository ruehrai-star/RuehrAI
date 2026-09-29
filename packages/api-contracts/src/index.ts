import type { components, operations, paths } from "./generated";

export type { components, operations, paths };

type Schemas = components["schemas"];

export type HealthResponse = Schemas["HealthResponse"];
export type Credentials = Schemas["Credentials"];
export type TokenResponse = Schemas["TokenResponse"];
export type User = Schemas["User"];
export type Grain = Schemas["Grain"];
export type SearchType = Schemas["SearchType"];
export type SearchHit = Schemas["SearchHit"];
export type SearchResponse = Schemas["SearchResponse"];
export type Geometry = Schemas["Geometry"];
export type Feature = Schemas["Feature"];
export type FeatureCollection = Schemas["FeatureCollection"];
export type ErrorResponse = Schemas["ErrorResponse"];
export type TargetRegion = Schemas["TargetRegion"];
export type TargetRegionWrite = Schemas["TargetRegionWrite"];
export type StoreLocation = Schemas["StoreLocation"];
export type StoreLocationWrite = Schemas["StoreLocationWrite"];
export type StoreList = Schemas["StoreList"];
export type MonthlyRevenuePoint = Schemas["MonthlyRevenuePoint"];
export type MonthlyRevenuePointWrite = Schemas["MonthlyRevenuePointWrite"];
export type MonthlyRevenueSeries = Schemas["MonthlyRevenueSeries"];
export type MonthlyRevenueWrite = Schemas["MonthlyRevenueWrite"];
