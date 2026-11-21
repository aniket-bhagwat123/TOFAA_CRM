import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    status_code = 400

    def __init__(self, message: str, data: Any = None, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        self.data = data
        if status_code:
            self.status_code = status_code


class UnauthorizedError(AppError):
    status_code = 401


class ForbiddenError(AppError):
    status_code = 403

    def __init__(self, message: str = "You do not have permission to do this."):
        super().__init__(message)


class NotFoundError(AppError):
    status_code = 404

    def __init__(self, message: str = "Record not found."):
        super().__init__(message)


class ConflictError(AppError):
    status_code = 409


def error_body(message: str, data: Any = None) -> dict:
    return {"data": data, "message": message}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(error_body(exc.message, exc.data), status_code=exc.status_code)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        return JSONResponse(error_body(str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        errors = [
            {"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]}
            for e in exc.errors()
        ]
        return JSONResponse(
            error_body("Request validation failed.", {"errors": errors}), status_code=422
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        # A database that is missing the photo columns (migration not applied yet) should say so,
        # on every route that touches them, instead of a bare 500.
        text = str(exc)
        if ("avatar_path" in text or "photo_path" in text) and ("42703" in text or "does not exist" in text):
            from src.core.storage import NOT_READY

            logging.getLogger(__name__).error("photo columns missing: the images migration has not been applied")
            return JSONResponse(error_body(NOT_READY), status_code=503)
        logging.getLogger(__name__).exception("unhandled error", exc_info=exc)
        return JSONResponse(error_body("Something went wrong."), status_code=500)
