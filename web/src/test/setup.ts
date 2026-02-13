import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Ensure each test starts with a clean DOM, even if a test fails early.
afterEach(() => cleanup());
