from flask import Flask, jsonify
import os

from database import init_db
from routes.auth_routes import bp as auth_bp
from routes.org_routes import bp as org_bp
from routes.kpi_routes import bp as kpi_bp
from routes.goal_routes import bp as goal_bp
from routes.competency_routes import bp as competency_bp
from routes.evaluation_routes import bp as evaluation_bp
from routes.dashboard_routes import bp as dashboard_bp
from routes.settings_routes import bp as settings_bp
from routes.ai_routes import bp as ai_bp
from routes.form_routes import bp as form_bp
from routes.reference_routes import bp as reference_bp
from routes.program_routes import bp as program_bp
from routes.strategic_goal_routes import bp as strategic_goal_bp
from routes.weekly_plan_routes import bp as weekly_plan_bp
from routes.tier_overview_routes import bp as tier_overview_bp
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = int(
    os.environ.get("PMS_MAX_CONTENT_LENGTH", str(2 * 1024 * 1024))
)

# Keep a safe local-development default. Production deployments must provide an
# explicit origin instead of silently allowing every website to call the API.
ALLOWED_ORIGIN = os.environ.get("PMS_ALLOWED_ORIGIN", "http://localhost:5173")
FLASK_DEBUG = os.environ.get("PMS_DEBUG", "0").lower() in ("1", "true", "yes")


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Vary"] = "Origin"
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


@app.route("/api/<path:_any>", methods=["OPTIONS"])
def cors_preflight(_any):
    return "", 204


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


app.register_blueprint(auth_bp)
app.register_blueprint(org_bp)
app.register_blueprint(kpi_bp)
app.register_blueprint(goal_bp)
app.register_blueprint(competency_bp)
app.register_blueprint(evaluation_bp)
app.register_blueprint(dashboard_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(form_bp)
app.register_blueprint(reference_bp)
app.register_blueprint(program_bp)
app.register_blueprint(strategic_goal_bp)
app.register_blueprint(weekly_plan_bp)
app.register_blueprint(tier_overview_bp)


@app.errorhandler(404)
def not_found(_e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(_e):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5001, debug=FLASK_DEBUG)
