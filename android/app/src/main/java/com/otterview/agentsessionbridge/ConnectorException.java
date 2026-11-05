package com.otterview.agentsessionbridge;
/** Controlled public errors: never forward a QR, bearer, response body or exception dump. */
final class ConnectorException extends java.io.IOException {
 final String code;
 ConnectorException(String code,String message){super(message);this.code=code;}
}
