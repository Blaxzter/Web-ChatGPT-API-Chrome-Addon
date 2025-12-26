import asyncio
import base64
import logging
import traceback
import uuid
from typing import Any, Literal

from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator

logging.basicConfig(level=logging.INFO)

app = FastAPI()


# Data model for incoming query requests
class QueryRequest(BaseModel):
    """Request model for sending queries to ChatGPT via the addon."""

    prompt: str = Field(..., description="The text prompt to send to ChatGPT")
    image: str | None = Field(None, description="Base64 encoded image data (optional)")
    startNewChat: bool = Field(
        True, description="Whether to create a new chat before executing"
    )
    useTemporaryChat: bool = Field(
        True, description="Whether to use temporary chat mode (disable for image generation)"
    )


# Data model for prompt message data sent to addon
class PromptMessageData(BaseModel):
    """Data structure for prompt messages sent to the addon."""

    prompt: str = Field(..., description="The text prompt to send to ChatGPT")
    startNewChat: bool = Field(
        True, description="Whether to create a new chat before executing"
    )
    image: str | None = Field(None, description="Base64 encoded image data (optional)")
    useTemporaryChat: bool = Field(
        True, description="Whether to use temporary chat mode (disable for image generation)"
    )


# Data model for generated image from ChatGPT
class GeneratedImageData(BaseModel):
    """Data structure for generated images from ChatGPT."""

    url: str = Field(..., description="Original URL of the generated image")
    base64: str = Field(..., description="Base64 encoded image data")
    alt: str = Field(..., description="Alt text for the image")


# Data model for response data received from addon
class ResponseMessageData(BaseModel):
    """Data structure for response messages received from the addon."""

    status: Literal["success", "error"] = Field(
        ..., description="Status of the response"
    )
    response: str | None = Field(None, description="The response text from ChatGPT")
    reason: str | None = Field(None, description="Error reason when status is 'error'")
    generatedImage: GeneratedImageData | None = Field(
        None, description="Generated image data if present"
    )


# Data model for messages exchanged over WebSocket
class WebSocketMessage(BaseModel):
    """WebSocket message format for communication between server and addon."""

    id: str = Field(..., description="Unique ID to correlate request and response")
    type: Literal["prompt", "response", "control"] = Field(
        ..., description="Message type"
    )
    data: PromptMessageData | ResponseMessageData | dict[str, Any] | str = Field(
        ..., description="Message payload - can be structured or string"
    )

    @field_validator("data", mode="before")
    @classmethod
    def validate_data(cls, v: Any) -> Any:
        # Accept strings, dicts, and Pydantic models
        if isinstance(v, (str, dict, BaseModel)):
            return v
        # If it's something else, try to convert to string
        return str(v)


# Response models for API endpoints
class QuerySuccessResponse(BaseModel):
    """Success response model for query endpoints."""

    status: Literal["success"] = Field("success", description="Response status")
    request_id: str = Field(..., description="Unique request identifier")
    response: str = Field(..., description="The response text from ChatGPT")
    generatedImage: GeneratedImageData | None = Field(
        None, description="Generated image data if present"
    )


class QueryErrorResponse(BaseModel):
    """Error response model for query endpoints."""

    status: Literal["error"] = Field("error", description="Response status")
    detail: str = Field(..., description="Error message")


class ConnectionManager:
    """Manages WebSocket connections and request/response correlation."""

    def __init__(self) -> None:
        self.active_connection: WebSocket | None = None
        self.pending_requests: dict[
            str, asyncio.Future[ResponseMessageData | dict[str, Any] | str]
        ] = {}  # To store Futures for correlating responses

    async def connect(self, websocket: WebSocket) -> None:
        """Accept and store a new WebSocket connection."""
        await websocket.accept()
        self.active_connection = websocket
        logging.info("WebSocket connection established.")

    def disconnect(self) -> None:
        """Close the WebSocket connection and cancel pending requests."""
        self.active_connection = None
        # Cancel any pending futures for this disconnected client
        for future in self.pending_requests.values():
            if not future.done():
                _ = future.cancel()
        self.pending_requests.clear()
        logging.info("WebSocket connection closed.")

    async def send_to_client(self, message: WebSocketMessage) -> None:
        """Send a message to the connected addon client."""
        if self.active_connection:
            try:
                await self.active_connection.send_text(message.model_dump_json())
                # logging.info(f"Sent message to client: {message.model_dump_json()}")
            except (
                RuntimeError
            ) as e:  # Handle cases where connection might close mid-send
                logging.error(f"Failed to send message to client: {e}")
                self.disconnect()  # Force disconnect if sending fails
        else:
            logging.warning("No active WebSocket connection to send message.")
            raise HTTPException(
                status_code=503, detail="WebSocket connection not established."
            )

    async def await_response(
        self, request_id: str
    ) -> ResponseMessageData | dict[str, Any] | str:
        """Creates a Future and waits for its result, associated with request_id."""
        future: asyncio.Future[ResponseMessageData | dict[str, Any] | str] = (
            asyncio.get_running_loop().create_future()
        )
        self.pending_requests[request_id] = future
        try:
            return await asyncio.wait_for(
                future, timeout=120
            )  # 2 minute timeout for response
        except asyncio.TimeoutError:
            logging.error(f"Timeout waiting for response for request ID: {request_id}")
            raise HTTPException(
                status_code=504, detail="Timeout waiting for response from addon."
            )
        except asyncio.CancelledError:
            logging.warning(f"Future for request ID {request_id} was cancelled.")
            raise HTTPException(
                status_code=503, detail="Request cancelled due to client disconnection."
            )
        finally:
            _ = self.pending_requests.pop(request_id, None)

    def complete_request(self, message: WebSocketMessage) -> None:
        """Completes a pending Future when a response is received."""
        if message.id in self.pending_requests:
            future = self.pending_requests.pop(message.id)
            if not future.done():
                # Handle ResponseMessageData Pydantic model
                if isinstance(message.data, ResponseMessageData):
                    if message.data.status == "error":
                        error_detail = message.data.reason or message.data.response or "Unknown error from addon"
                        future.set_exception(
                            HTTPException(
                                status_code=400,
                                detail=error_detail,
                            )
                        )
                    else:
                        # For success responses, convert to dict
                        future.set_result(message.data.model_dump())
                # If data is a dict with status/response structure, extract or pass as-is
                elif isinstance(message.data, dict):
                    # Check if it's an error response
                    if message.data.get("status") == "error":
                        error_detail = message.data.get(
                            "reason", message.data.get("response", "Unknown error from addon")
                        )
                        future.set_exception(
                            HTTPException(
                                status_code=400,
                                detail=error_detail,
                            )
                        )
                    else:
                        # For success or other structured responses, pass the whole dict
                        future.set_result(message.data)
                elif isinstance(message.data, str):
                    # For simple string responses
                    future.set_result(message.data)
                else:
                    # For other Pydantic model responses, convert to dict
                    if hasattr(message.data, "model_dump"):
                        future.set_result(message.data.model_dump())
                    else:
                        future.set_result(str(message.data))
                logging.info(f"Completed request ID: {message.id}")
        else:
            logging.warning(
                f"Received response for unknown or completed request ID: {message.id}"
            )


manager = ConnectionManager()


def truncate_base64_in_log(data: str) -> str:
    """
    Truncate base64 encoded strings in log messages for readability.
    Replaces long base64 strings with a placeholder showing their length.
    """
    import json
    import re
    
    try:
        # Try to parse as JSON
        parsed = json.loads(data)
        
        # Recursively truncate base64 strings in the parsed data
        def truncate_recursive(obj: Any) -> Any:
            if isinstance(obj, dict):
                return {k: truncate_recursive(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [truncate_recursive(item) for item in obj]
            elif isinstance(obj, str):
                # Check if it looks like base64 (long string with base64 characters)
                if len(obj) > 100 and re.match(r'^[A-Za-z0-9+/=]+$', obj):
                    return f"<base64 data: {len(obj)} chars>"
                return obj
            return obj
        
        truncated = truncate_recursive(parsed)
        return json.dumps(truncated, indent=2)
    except (json.JSONDecodeError, Exception):
        # If not JSON or error, just return original
        return data


@app.get("/", response_class=HTMLResponse)
async def get() -> HTMLResponse:
    """Root endpoint to check if the server is running."""
    return HTMLResponse("<h2>ChatGPT Addon Server is running.</h2>")


@app.get("/health")
async def health_check() -> dict[str, Any]:
    """
    Health check endpoint that verifies server status and addon connection.

    Returns:
        A dictionary containing:
        - status: "healthy" if addon is connected, "degraded" if not
        - addon_connected: Boolean indicating WebSocket connection status
        - pending_requests: Number of requests awaiting response
    """
    addon_connected = manager.active_connection is not None
    pending_count = len(manager.pending_requests)

    return {
        "status": "healthy" if addon_connected else "degraded",
        "addon_connected": addon_connected,
        "pending_requests": pending_count,
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for addon communication."""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            logging.info(f"Received raw message from client: {truncate_base64_in_log(data)}")
            try:
                msg = WebSocketMessage.model_validate_json(data)
                if msg.type == "response":
                    manager.complete_request(msg)
                elif msg.type == "control":
                    # Handle control messages like keep-alive pings
                    logging.debug(f"Received control message: {msg.data}")
                    # Could send a pong back if needed
                else:
                    logging.warning(
                        f"Received unhandled message type: {msg.type} with ID: {msg.id}"
                    )
            except Exception as e:
                logging.error(
                    f"Error parsing WebSocket message: {e} - Raw data: {data}"
                )
    except WebSocketDisconnect:
        manager.disconnect()
    except Exception as e:
        logging.error(f"WebSocket error: {e}")
        manager.disconnect()


@app.post("/query", response_model=QuerySuccessResponse)
async def send_query(query_request: QueryRequest) -> dict[str, Any]:
    """
    Send a query with optional base64-encoded image.

    Example:
        {
            "prompt": "What's in this image?",
            "image": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            "startNewChat": true,
            "useTemporaryChat": false
        }

    Parameters:
        - prompt: The text prompt to send to ChatGPT
        - image: Optional base64-encoded image data
        - startNewChat: Whether to create a new chat before executing (default: true)
        - useTemporaryChat: Whether to use temporary chat mode (default: true, set false for image generation)

    Returns:
        QuerySuccessResponse with status, request_id, and response text
    """
    if not manager.active_connection:
        raise HTTPException(
            status_code=503, detail="WebSocket connection not established with addon."
        )

    request_id = uuid.uuid4().hex
    # Create structured message data using Pydantic model
    message_data = PromptMessageData(
        prompt=query_request.prompt,
        startNewChat=query_request.startNewChat,
        image=query_request.image,
        useTemporaryChat=query_request.useTemporaryChat,
    )

    prompt_message = WebSocketMessage(id=request_id, type="prompt", data=message_data)

    await manager.send_to_client(
        prompt_message
    )  # This might raise HTTPException if send fails

    try:
        # Wait for the response from the addon
        response_data = await manager.await_response(request_id)

        # If response_data is already a dict (structured response), return it
        if isinstance(response_data, dict):
            return {"status": "success", "request_id": request_id, **response_data}
        else:
            # For simple string responses
            return {
                "status": "success",
                "request_id": request_id,
                "response": response_data,
            }
    except HTTPException:
        # Re-raise HTTPExceptions (including those from error responses)
        raise
    except Exception as e:
        logging.error(f"Error sending query: {e}")
        traceback.print_exc()
        raise e


@app.post("/query/upload", response_model=QuerySuccessResponse)
async def send_query_with_upload(
    prompt: str = Form(...),
    image: UploadFile | None = File(None),
    startNewChat: bool = Form(True),
    useTemporaryChat: bool = Form(True),
) -> dict[str, Any]:
    """
    Send a query with optional file upload (image will be auto-encoded to base64).
    
    Example using curl:
        curl -X POST "http://localhost:8000/query/upload" \\
             -F "prompt=What's in this image?" \\
             -F "image=@path/to/image.png" \\
             -F "startNewChat=true"
    
    Example using Python requests:
        import requests
        
        with open("image.png", "rb") as f:
            response = requests.post(
                "http://localhost:8000/query/upload",
                data={"prompt": "What's in this image?", "startNewChat": True},
                files={"image": f}
            )
    
    Parameters:
        - prompt: The text prompt to send to ChatGPT
        - image: Optional image file to upload
        - startNewChat: Whether to create a new chat before executing (default: true)
        - useTemporaryChat: Whether to use temporary chat mode (default: true, set false for image generation)

    Returns:
        QuerySuccessResponse with status, request_id, and response text
    """
    if not manager.active_connection:
        raise HTTPException(
            status_code=503, detail="WebSocket connection not established with addon."
        )

    request_id = uuid.uuid4().hex
    image_base64: str | None = None

    # If an image file is uploaded, read and encode it to base64
    if image:
        try:
            # Read the file contents
            image_bytes = await image.read()

            # Encode to base64
            image_base64 = base64.b64encode(image_bytes).decode("utf-8")

            logging.info(
                f"Image uploaded: {image.filename} ({len(image_bytes)} bytes, {len(image_base64)} base64 chars)"
            )
        except Exception as e:
            logging.error(f"Error processing uploaded image: {e}")
            raise HTTPException(
                status_code=400, detail=f"Failed to process uploaded image: {str(e)}"
            )

    # Create structured message data using Pydantic model
    message_data = PromptMessageData(
        prompt=prompt, startNewChat=startNewChat, image=image_base64, useTemporaryChat=useTemporaryChat
    )

    prompt_message = WebSocketMessage(id=request_id, type="prompt", data=message_data)

    await manager.send_to_client(
        prompt_message
    )  # This might raise HTTPException if send fails

    try:
        # Wait for the response from the addon
        response_data = await manager.await_response(request_id)

        # If response_data is already a dict (structured response), return it
        if isinstance(response_data, dict):
            return {"status": "success", "request_id": request_id, **response_data}
        else:
            # For simple string responses
            return {
                "status": "success",
                "request_id": request_id,
                "response": response_data,
            }
    except HTTPException:
        # Re-raise HTTPExceptions (including those from error responses)
        raise
    except Exception as e:
        logging.error(f"Error sending query with upload: {e}")
        traceback.print_exc()
        raise e


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
