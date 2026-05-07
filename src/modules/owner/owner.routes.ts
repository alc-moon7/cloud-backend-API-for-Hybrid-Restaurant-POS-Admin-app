import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../../shared/async-handler.js';
import {
  completeOwnerOnboarding,
  confirmOwnerPayment,
  createOwnerPaymentSession,
  getOwnerPaymentStatus,
  listOwnerPlans,
  loginOwner,
  loginStaff,
  requestOwnerOtp,
  verifyOwnerOtp,
} from './owner.service.js';

const requestOtpSchema = z.object({
  phone: z.string().min(1),
});

const verifyOtpSchema = z.object({
  phone: z.string().min(1),
  otp: z.string().min(1),
});

const paymentSessionSchema = z.object({
  phone: z.string().min(1),
  planCode: z.string().min(1),
  billingCycle: z.enum(['monthly', 'annual']),
  paymentMethod: z.enum(['bkash', 'nagad', 'bank', 'card']),
});

const paymentCallbackSchema = z.object({
  paymentSessionId: z.string().min(1),
  status: z.string().min(1),
});

const ownerSetupSchema = z.object({
  phone: z.string().min(1),
  paymentSessionId: z.string().min(1),
  restaurantName: z.string().min(1),
  firstOutletName: z.string().min(1),
  ownerPassword: z.string().min(8),
  adminPin: z.string().min(4),
});

const ownerLoginSchema = z.object({
  phone: z.string().min(1),
  password: z.string().min(1),
});

const staffLoginSchema = z.object({
  pin: z.string().min(1),
});

export const ownerRouter = Router();
export const staffAuthRouter = Router();

ownerRouter.get(
  '/plans',
  asyncHandler(async (_request, response) => {
    response.json(listOwnerPlans());
  }),
);

ownerRouter.post(
  '/auth/request-otp',
  asyncHandler(async (request, response) => {
    const body = requestOtpSchema.parse(request.body);
    response.json(await requestOwnerOtp(body.phone));
  }),
);

ownerRouter.post(
  '/auth/verify-otp',
  asyncHandler(async (request, response) => {
    const body = verifyOtpSchema.parse(request.body);
    response.json(await verifyOwnerOtp(body.phone, body.otp));
  }),
);

ownerRouter.post(
  '/payments/session',
  asyncHandler(async (request, response) => {
    const body = paymentSessionSchema.parse(request.body);
    response.json(await createOwnerPaymentSession(body));
  }),
);

ownerRouter.post(
  '/payments/callback',
  asyncHandler(async (request, response) => {
    const body = paymentCallbackSchema.parse(request.body);
    response.json(await confirmOwnerPayment(body));
  }),
);

ownerRouter.get(
  '/payments/status',
  asyncHandler(async (request, response) => {
    const paymentSessionId = request.query.paymentSessionId?.toString() ?? '';
    response.json(await getOwnerPaymentStatus(paymentSessionId));
  }),
);

ownerRouter.post(
  '/onboarding/setup',
  asyncHandler(async (request, response) => {
    const body = ownerSetupSchema.parse(request.body);
    response.json(await completeOwnerOnboarding(body));
  }),
);

ownerRouter.post(
  '/auth/login',
  asyncHandler(async (request, response) => {
    const body = ownerLoginSchema.parse(request.body);
    response.json(await loginOwner(body));
  }),
);

staffAuthRouter.post(
  '/login',
  asyncHandler(async (request, response) => {
    const body = staffLoginSchema.parse(request.body);
    response.json(await loginStaff(body.pin));
  }),
);
