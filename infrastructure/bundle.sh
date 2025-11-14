#!/bin/sh

cd lambda && npm install && zip -r ../lambda.zip index.js package.json node_modules && cd ..
