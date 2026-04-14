import { Router } from "express";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../db/prisma.js";
import { generateToken } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";
import { env } from "../config/env.js";

const router = Router();
const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { email, password, name, roleId, orgNodeId, phone } = req.body;

    if (!email || !password || !name || !roleId || !orgNodeId) {
      res.status(400).json({ error: "Missing required fields: email, password, name, roleId, orgNodeId" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { email, passwordHash, name, roleId, orgNodeId, phone },
      include: { role: true },
    });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role.name,
      orgNodeId: user.orgNodeId,
      permissions: user.role.permissions as Record<string, boolean>,
    });

    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role.name } });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password required" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true, orgNode: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // Update last login
    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role.name,
      orgNodeId: user.orgNodeId,
      permissions: user.role.permissions as Record<string, boolean>,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.name,
        orgNode: user.orgNode.name,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/auth/google — Sign in with Google (primary auth method)
router.post("/google", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      res.status(400).json({ error: "Google credential required" });
      return;
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      res.status(401).json({ error: "Invalid Google token" });
      return;
    }

    const { email, name, picture, sub: googleId } = payload;

    // Only allow @emoenergy.in domain
    const ALLOWED_DOMAIN = "emoenergy.in";
    const emailDomain = email.split("@")[1]?.toLowerCase();
    if (emailDomain !== ALLOWED_DOMAIN) {
      res.status(403).json({ error: `Only @${ALLOWED_DOMAIN} accounts are allowed` });
      return;
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email },
      include: { role: true, orgNode: true },
    });

    if (!user) {
      // Auto-create: assign "employee" role and root org node
      const employeeRole = await prisma.role.findFirst({ where: { name: "employee" } });
      const rootOrg = await prisma.orgNode.findFirst({ where: { parentId: null } });

      if (!employeeRole || !rootOrg) {
        res.status(500).json({ error: "System not initialized. Seed roles and org nodes first." });
        return;
      }

      user = await prisma.user.create({
        data: {
          email,
          name: name || email.split("@")[0],
          passwordHash: "", // No password for Google users
          roleId: employeeRole.id,
          orgNodeId: rootOrg.id,
        },
        include: { role: true, orgNode: true },
      });

      console.log(`New Google user created: ${email} (${user.role.name})`);
    }

    if (!user.isActive) {
      res.status(403).json({ error: "Account is deactivated" });
      return;
    }

    // Update last login
    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role.name,
      orgNodeId: user.orgNodeId,
      permissions: user.role.permissions as Record<string, boolean>,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.name,
        orgNode: user.orgNode.name,
      },
    });
  } catch (err: any) {
    console.error("Google auth error:", err?.message || err);
    res.status(401).json({ error: "Google authentication failed" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { role: true, orgNode: true },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role.name,
      permissions: user.role.permissions,
      orgNode: { id: user.orgNode.id, name: user.orgNode.name, level: user.orgNode.level },
      allowedLocations: req.user!.allowedLocations,
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// PATCH /api/auth/phone — link phone number for WhatsApp bot access
router.patch("/phone", requireAuth, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      res.status(400).json({ error: "Phone number is required" });
      return;
    }

    // Normalize: strip spaces, dashes, plus. Keep only digits.
    const normalized = phone.replace(/[\s\-\+\(\)]/g, "");
    if (normalized.length < 10) {
      res.status(400).json({ error: "Invalid phone number" });
      return;
    }

    // Check if this phone is already linked to another user
    const existing = await prisma.user.findFirst({
      where: { phone: normalized, id: { not: req.user!.userId } },
    });
    if (existing) {
      res.status(409).json({ error: "This phone number is already linked to another account" });
      return;
    }

    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { phone: normalized },
    });

    res.json({ ok: true, phone: normalized, message: "Phone linked! You can now message the EMO WhatsApp number to chat with the AI." });
  } catch (err) {
    console.error("Phone update error:", err);
    res.status(500).json({ error: "Failed to update phone" });
  }
});

// DELETE /api/auth/phone — unlink phone number
router.delete("/phone", requireAuth, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { phone: null },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to unlink phone" });
  }
});

// PATCH /api/auth/users/:id/role — admin-only: change a user's role
router.patch("/users/:id/role", requireAuth, async (req, res) => {
  try {
    // Check caller is admin
    const caller = await prisma.user.findUnique({ where: { id: req.user!.userId }, include: { role: true } });
    if (caller?.role.name !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const { roleName } = req.body;
    const role = await prisma.role.findFirst({ where: { name: roleName } });
    if (!role) { res.status(400).json({ error: `Role '${roleName}' not found` }); return; }

    const userId = req.params.id as string;
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { roleId: role.id },
      include: { role: true },
    });

    res.json({ ok: true, user: updated.name, role: (updated as any).role.name });
  } catch (err) {
    res.status(500).json({ error: "Failed to update role" });
  }
});

// GET /api/auth/users — admin-only: list all users
router.get("/users", requireAuth, async (req, res) => {
  try {
    const caller = await prisma.user.findUnique({ where: { id: req.user!.userId }, include: { role: true } });
    if (caller?.role.name !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const users = await prisma.user.findMany({
      include: { role: true, orgNode: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.json(users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role.name,
      orgNode: u.orgNode?.name,
      isActive: u.isActive,
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to list users" });
  }
});

export default router;
