from datetime import datetime

from pydantic import EmailStr, Field, field_validator

from app.schemas.common import OrmBase


class RoleRead(OrmBase):
    id: int
    name: str
    description: str | None = None


class UserCreate(OrmBase):
    email: EmailStr
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_-]+$")
    full_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    role_ids: list[int] = []


class UserUpdate(OrmBase):
    full_name: str | None = None
    email: EmailStr | None = None
    is_active: bool | None = None
    role_ids: list[int] | None = None


class UserRead(OrmBase):
    id: int
    email: str
    username: str
    full_name: str
    is_active: bool
    is_superuser: bool
    email_verified: bool = False
    avatar_url: str | None = None
    last_login_at: datetime | None = None
    created_at: datetime
    roles: list[RoleRead] = []

    @field_validator("roles", mode="before")
    @classmethod
    def _coerce_roles(cls, v):
        """
        SQLAlchemy relationship `User.roles` is a list of `UserRole` rows
        (with a `.role` relationship), but the API schema expects `RoleRead`.

        This validator converts each `UserRole` -> its `.role` for correct
        serialization and avoids 500s on `/auth/me` and `/users` endpoints.
        """
        if v is None:
            return []

        out: list[RoleRead | object] = []
        for item in v:
            role_obj = getattr(item, "role", None)
            if role_obj is not None:
                out.append(RoleRead.model_validate(role_obj))
            else:
                out.append(item)
        return out

    @property
    def role_names(self) -> list[str]:
        return [r.name for r in self.roles]


class TokenResponse(OrmBase):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class LoginRequest(OrmBase):
    username: str
    password: str


class RefreshRequest(OrmBase):
    refresh_token: str


class PasswordChangeRequest(OrmBase):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class AdminPasswordResetRequest(OrmBase):
    new_password: str = Field(min_length=8, max_length=128)


class OTPVerifyRequest(OrmBase):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class OTPSendRequest(OrmBase):
    email: EmailStr


class PasswordResetRequest(OrmBase):
    email: EmailStr


class PasswordResetConfirm(OrmBase):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=128)

