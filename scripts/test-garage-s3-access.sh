#!/bin/bash
# Test Garage S3 access to drawrace-pg-backups bucket

set -e

# Configuration
GARAGE_ENDPOINT="http://garage.ardenone-hub.svc:3900"
BUCKET_NAME="drawrace-pg-backups"
TEST_FILE="/tmp/garage-test-$(date +%s).txt"
TEST_OBJECT_KEY="test-connection-$(date +%s).txt"

echo "=== Garage S3 Access Test for ${BUCKET_NAME} ==="
echo "Endpoint: ${GARAGE_ENDPOINT}"
echo "Test file: ${TEST_FILE}"
echo "Test object key: ${TEST_OBJECT_KEY}"
echo ""

# Create test file
echo "This is a test file for Garage S3 access verification - $(date)" > "${TEST_FILE}"

echo "=== TEST 1: List Objects (Read Access) ==="
echo "Attempting to list objects in s3://${BUCKET_NAME}/"

if aws s3 ls "s3://${BUCKET_NAME}/" \
    --endpoint-url="${GARAGE_ENDPOINT}" \
    --no-verify-ssl 2>/dev/null; then
    echo "✅ READ TEST PASSED: Successfully listed objects"
    READ_TEST="PASS"
else
    echo "❌ READ TEST FAILED: Could not list objects"
    READ_TEST="FAIL"
fi

echo ""
echo "=== TEST 2: Upload Test Object (Write Access) ==="
echo "Attempting to upload ${TEST_FILE} to s3://${BUCKET_NAME}/${TEST_OBJECT_KEY}"

if aws s3 cp "${TEST_FILE}" "s3://${BUCKET_NAME}/${TEST_OBJECT_KEY}" \
    --endpoint-url="${GARAGE_ENDPOINT}" \
    --no-verify-ssl 2>/dev/null; then
    echo "✅ WRITE TEST PASSED: Successfully uploaded test object"
    WRITE_TEST="PASS"
else
    echo "❌ WRITE TEST FAILED: Could not upload test object"
    WRITE_TEST="FAIL"
fi

echo ""
echo "=== TEST 3: Cleanup (Delete Test Object) ==="
if [ "${WRITE_TEST}" = "PASS" ]; then
    echo "Attempting to delete s3://${BUCKET_NAME}/${TEST_OBJECT_KEY}"

    if aws s3 rm "s3://${BUCKET_NAME}/${TEST_OBJECT_KEY}" \
        --endpoint-url="${GARAGE_ENDPOINT}" \
        --no-verify-ssl 2>/dev/null; then
        echo "✅ CLEANUP PASSED: Successfully deleted test object"
        CLEANUP_TEST="PASS"
    else
        echo "⚠️  CLEANUP FAILED: Could not delete test object (may require manual cleanup)"
        CLEANUP_TEST="FAIL"
    fi
else
    echo "⏭️  CLEANUP SKIPPED: No test object to delete"
    CLEANUP_TEST="SKIP"
fi

# Cleanup local test file
rm -f "${TEST_FILE}"

echo ""
echo "=== TEST SUMMARY ==="
echo "Read Test:  ${READ_TEST:-UNKNOWN}"
echo "Write Test: ${WRITE_TEST:-UNKNOWN}"
echo "Cleanup:    ${CLEANUP_TEST:-UNKNOWN}"

if [ "${READ_TEST}" = "PASS" ] && [ "${WRITE_TEST}" = "PASS" ]; then
    echo ""
    echo "✅ ALL TESTS PASSED: Garage S3 key has full read/write access"
    exit 0
else
    echo ""
    echo "❌ TESTS FAILED: Garage S3 key access is incomplete"
    exit 1
fi
