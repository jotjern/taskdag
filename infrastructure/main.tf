terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

#####################
# Variables
#####################

variable "region" {
  type    = string
  default = "us-west-1"
}

variable "bucket_name" {
  type = string
}

variable "presign_expires_seconds" {
  type    = number
  default = 3600
}

variable "lambda_password" {
  type        = string
  description = "Password that clients must provide to receive pre-signed URLs"
}

#####################
# S3 bucket
#####################

resource "aws_s3_bucket" "state" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "HEAD"]
    allowed_origins = [
      "http://localhost:5173",
      "https://jotjern.github.io",
    ]
    max_age_seconds = 300
  }
}

#####################
# IAM Role for Lambda
#####################

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "lambda_role" {
  name               = "presign-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

# Inline policy: logs + S3 read/write for this bucket
data "aws_iam_policy_document" "lambda_policy" {
  statement {
    effect = "Allow"

    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = ["arn:aws:logs:*:*:*"]
  }

  statement {
    effect = "Allow"

    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]

    resources = [
      "${aws_s3_bucket.state.arn}/*"
    ]
  }

  statement {
    effect = "Allow"

    actions = [
      "s3:ListBucket",
    ]

    resources = [
      aws_s3_bucket.state.arn
    ]
  }
}

resource "aws_iam_role_policy" "lambda_policy" {
  name   = "presign-lambda-inline-policy"
  role   = aws_iam_role.lambda_role.id
  policy = data.aws_iam_policy_document.lambda_policy.json
}

#####################
# Lambda function
#####################



resource "aws_lambda_function" "presign" {
  function_name = "presign-state-object"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"

  filename         = "lambda.zip"      # Build & zip index.js + node_modules yourself
  source_code_hash = filebase64sha256("lambda.zip")

  environment {
    variables = {
      BUCKET_NAME             = aws_s3_bucket.state.bucket
      API_PASSWORD            = var.lambda_password
      PRESIGN_EXPIRES_SECONDS = tostring(var.presign_expires_seconds)
    }
  }
}

#####################
# HTTP API Gateway 2
#####################

resource "aws_apigatewayv2_api" "http_api" {
  name          = "presign-http-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = [
      "http://localhost:5173",
      "https://jotjern.github.io",
    ]
    allow_methods = ["OPTIONS", "POST"]
    allow_headers = ["Content-Type", "Authorization"]
  }
}

resource "aws_apigatewayv2_integration" "lambda_integration" {
  api_id = aws_apigatewayv2_api.http_api.id

  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.presign.arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_route" "presign_route" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /presign"

  target = "integrations/${aws_apigatewayv2_integration.lambda_integration.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true
}

# Allow API Gateway to invoke Lambda
resource "aws_lambda_permission" "allow_apigw" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.presign.function_name
  principal     = "apigateway.amazonaws.com"

  source_arn = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

#####################
# Outputs
#####################

output "api_endpoint" {
  value = aws_apigatewayv2_api.http_api.api_endpoint
}

output "bucket_name" {
  value = aws_s3_bucket.state.bucket
}
