# @creator-outdoor/domain

Pure business rules for Creator Outdoor.

This package has **no runtime dependencies**. It must never import React, Next.js,
Elysia, Drizzle, PostgreSQL, a payment provider SDK, an email provider SDK, or any
hosting-platform API. Everything here is a deterministic function of its arguments,
which makes it the primary mutation-testing target.

Callers pass configuration in explicitly (timezone, minimum boost, rotation hours);
this package never reads `process.env`.
