import { Router } from "express";

export interface Package {
  name: string;
  price: number;
  display_price: string;
  validity: string;
  mikrotik_profile: string;
}

export const packages: Record<string, Package> = {
  daily: {
    name: "Daily",
    price: 100,
    display_price: "GHS 1.00",
    validity: "24 hours",
    mikrotik_profile: "daily",
  },
  monthly: {
    name: "Monthly",
    price: 200,
    display_price: "GHS 2.00",
    validity: "30 days",
    mikrotik_profile: "monthly",
  },
};

const router = Router();

router.get("/", (_req, res) => {
  res.json(packages);
});

export default router;
