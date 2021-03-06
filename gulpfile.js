const gulp = require('gulp');
const csso = require('gulp-csso');
const uglify = require('gulp-uglify');
const autoprefixer = require('gulp-autoprefixer');
const rename = require('gulp-rename');

// Set the browser that you want to support
const AUTOPREFIXER_BROWSERS = [
  'ie >= 10',
  'ie_mob >= 10',
  'ff >= 30',
  'chrome >= 34',
  'safari >= 7',
  'opera >= 23',
  'ios >= 7',
  'android >= 4.4',
  'bb >= 10'
];

gulp.task('scripts', function() {
  return gulp.src('./html/**/*.js')
    // Minify the file
    .pipe(uglify())
    .pipe(rename({
            suffix: '.min'
        }))
    // Output
    .pipe(gulp.dest(function(file) {
            return file.base;
        }))
});

// Gulp task to minify CSS files
gulp.task('styles', function () {
  return gulp.src('./html/**/*.css')
    // Auto-prefix css styles for cross browser compatibility
    .pipe(autoprefixer({browsers: AUTOPREFIXER_BROWSERS}))
    // Minify the file
    .pipe(csso())
    .pipe(rename({
            suffix: '.min'
        }))
    // Output
    .pipe(gulp.dest(function(file) {
            return file.base;
        }))
});
