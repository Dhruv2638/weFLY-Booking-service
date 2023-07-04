const axios = require("axios");

const { BookingRepository } = require("../repostories");

const { ServerConfig } = require("../config");

const db = require("../models");
const { AppError } = require("../utils/errors/app-error");
const { StatusCodes } = require("http-status-codes");
const serverConfig = require("../config/server-config");

const { Enums } = require("../utils/common");
const { data } = require("../utils/common/error-response");

const { BOOKED, INITIATED, PENDING, CANCELLED } = Enums.BOOKING_STATUS;

const bookingRepository = new BookingRepository();

async function createBooking(data) {
  const transaction = await db.sequelize.transaction();
  try {
    console.log(data);
    const flight = await axios.get(
      `${ServerConfig.FLIGHT_SERVICE}/api/v1/flights/${data.flightId}`
    );
    const flightData = flight.data.data;
    if (data.noOfSeats > flightData.totalSeats) {
      throw new AppError(
        "Not enough seats are available",
        StatusCodes.BAD_REQUEST
      );
    }
    const totalBillingAmount = flightData.price * data.noOfSeats;
    const bookingPayload = { ...data, totalCost: totalBillingAmount };
    const booking = await bookingRepository.create(bookingPayload, transaction);

    await axios.patch(
      `${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${data.flightId}/seats`,
      {
        seats: data.noOfSeats,
      }
    );
    await transaction.commit();
    return booking;
  } catch (error) {
    await transaction.rollback();
    console.log(error);
    throw error;
  }
}

async function makePayment(data) {
  const transaction = await db.sequelize.transaction();
  try {
    const bookingDetails = await bookingRepository.get(
      data.bookingId,
      transaction
    );
    if (bookingDetails.status == CANCELLED) {
      throw new AppError(
        "This ticket is already cancled!",
        StatusCodes.BAD_REQUEST
      );
    }
    const bookingTime = new Date(bookingDetails.createdAt);
    const currentTime = new Date();
    if (bookingTime - currentTime > 300000) {
      await cancleBooking(data.bookingId);
      throw new AppError(
        "The booking times is expired!",
        StatusCodes.BAD_REQUEST
      );
    }
    if (bookingDetails.totalCost != data.totalCost) {
      throw new AppError(
        "The amount of payment do not match",
        StatusCodes.BAD_REQUEST
      );
    }

    if (bookingDetails.userId != data.userId) {
      throw new AppError(
        "The user id not match with payment user id!",
        StatusCodes.BAD_REQUEST
      );
    }

    await bookingRepository.update(
      data.bookingId,
      { status: BOOKED },
      transaction
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    console.log(error);
    throw error;
  }
}

async function cancleBooking(bookingId) {
  const transaction = await db.sequelize.transaction();
  try {
    const bookingDetails = await bookingRepository.get(bookingId, transaction);
    if (bookingDetails.status == CANCELLED) {
      await transaction.commit();
      return true;
    }
    await axios.patch(
      `${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${bookingDetails.flightId}/seats`,
      {
        seats: bookingDetails.noOfSeats,
        dec: 0,
      }
    );
    await bookingRepository.update(
      bookingId,
      { status: CANCELLED },
      transaction
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    console.log(error);
    throw error;
  }
}

async function cancelOldBookings() {
  try {
    console.log("Inside service");
    const time = new Date(Date.now() - 1000 * 300); // time 5 mins ago
    const response = await bookingRepository.cancelOldBookings(time);

    return response;
  } catch (error) {
    console.log(error);
  }
}

module.exports = {
  createBooking,
  makePayment,
  cancelOldBookings,
};
